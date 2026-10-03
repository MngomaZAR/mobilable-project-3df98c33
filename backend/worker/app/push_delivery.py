import json
import os
import random
import re
from datetime import UTC, datetime, timedelta

import httpx


EXPO_BASE = 'https://exp.host/--/api/v2/push'
TOKEN_RE = re.compile(r'^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]+\]$')
MAX_ATTEMPTS = 8
PERMANENT_ERRORS = {'DeviceNotRegistered', 'MessageTooBig', 'InvalidCredentials', 'MismatchSenderId'}


def headers():
    value = {'Accept': 'application/json', 'Content-Type': 'application/json'}
    if os.getenv('EXPO_ACCESS_TOKEN'):
        value['Authorization'] = f"Bearer {os.environ['EXPO_ACCESS_TOKEN']}"
    return value


def retry_delay(attempt: int) -> int:
    return min(3600, 10 * 2 ** min(attempt, 8)) + random.randint(0, 10)


async def disable_token(conn, delivery):
    # Do not disable a new registration because an old token's receipt failed.
    await conn.execute('UPDATE push_tokens SET enabled=false,updated_at=now() WHERE id=$1 AND expo_push_token=$2', delivery['token_id'], delivery['expo_push_token'])


async def finish_send(conn, row, state: str, code=None, ticket=None):
    await conn.execute(
        """UPDATE push_deliveries SET status=$3,last_error=$4,ticket_id=$5,
        accepted_at=CASE WHEN $5::text IS NOT NULL THEN now() ELSE accepted_at END,
        next_attempt_at=now()+$6::int*interval '1 second',locked_at=NULL,updated_at=now()
        WHERE id=$1 AND status='sending' AND attempts=$2""",
        row['id'], row['attempts'], state, code, ticket, 900 if ticket else retry_delay(row['attempts']),
    )


async def send_pending(conn, client: httpx.AsyncClient) -> bool:
    async with conn.transaction():
        rows = await conn.fetch(
            """WITH candidates AS (SELECT id FROM push_deliveries
            WHERE (status='pending' AND next_attempt_at<=now()) OR (status='sending' AND locked_at<now()-interval '5 minutes')
            ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 100)
            UPDATE push_deliveries d SET status='sending',attempts=d.attempts+1,locked_at=now(),updated_at=now()
            FROM candidates c WHERE d.id=c.id RETURNING d.*""",
        )
    if not rows:
        return False
    eligible, messages = [], []
    for row in rows:
        if row['attempts'] > MAX_ATTEMPTS:
            await finish_send(conn, row, 'failed', 'AttemptsExhausted')
            continue
        token = await conn.fetchrow('SELECT enabled,expo_push_token FROM push_tokens WHERE id=$1', row['token_id'])
        if not token or not token['enabled'] or token['expo_push_token'] != row['expo_push_token']:
            await finish_send(conn, row, 'failed', 'TokenDisabledOrReplaced')
            continue
        if not TOKEN_RE.fullmatch(row['expo_push_token']):
            await disable_token(conn, row)
            await finish_send(conn, row, 'failed', 'InvalidPushToken')
            continue
        notification = await conn.fetchrow('SELECT title,body,action_payload FROM notification_events WHERE id=$1', row['notification_id'])
        if not notification:
            await finish_send(conn, row, 'failed', 'NotificationMissing')
            continue
        data = notification['action_payload'] or {}
        if isinstance(data, str):
            data = json.loads(data)
        messages.append({'to': row['expo_push_token'], 'title': notification['title'], 'body': notification['body'],
                         'data': {**data, 'notification_id': row['notification_id']}, 'sound': 'default'})
        eligible.append(row)
    if not eligible:
        return True
    try:
        response = await client.post(f'{EXPO_BASE}/send', json=messages, headers=headers())
        response.raise_for_status()
        tickets = response.json().get('data')
        if not isinstance(tickets, list) or len(tickets) != len(eligible):
            raise ValueError('Invalid push tickets')
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as error:
        permanent = isinstance(error, httpx.HTTPStatusError) and 400 <= error.response.status_code < 500 and error.response.status_code != 429
        code = f'HTTP{error.response.status_code}' if isinstance(error, httpx.HTTPStatusError) else type(error).__name__
        for row in eligible:
            await finish_send(conn, row, 'failed' if permanent or row['attempts'] >= MAX_ATTEMPTS else 'pending', code)
        return True
    # Persist successes even when another device in the batch was rejected.
    for row, ticket in zip(eligible, tickets):
        if isinstance(ticket, dict) and ticket.get('status') == 'ok' and isinstance(ticket.get('id'), str) and ticket['id']:
            await finish_send(conn, row, 'ticket', ticket=ticket['id'])
        else:
            details = ticket.get('details') if isinstance(ticket, dict) else None
            code = details.get('error') if isinstance(details, dict) else None
            code = code if code in PERMANENT_ERRORS or code == 'MessageRateExceeded' else 'UnknownTicketError'
            if code == 'DeviceNotRegistered':
                await disable_token(conn, row)
            await finish_send(conn, row, 'failed' if code in PERMANENT_ERRORS or row['attempts'] >= MAX_ATTEMPTS else 'pending', code)
    return True


async def finish_receipt(conn, row, state: str, code=None, resend=False):
    await conn.execute(
        """UPDATE push_deliveries SET status=$3,last_error=$4,
        ticket_id=CASE WHEN $5::boolean THEN NULL ELSE ticket_id END,
        accepted_at=CASE WHEN $5::boolean THEN NULL ELSE accepted_at END,
        next_attempt_at=now()+interval '5 minutes',locked_at=NULL,updated_at=now()
        WHERE id=$1 AND status='checking' AND receipt_attempts=$2""",
        row['id'], row['receipt_attempts'], state, code, resend,
    )


async def reconcile_receipts(conn, client: httpx.AsyncClient) -> bool:
    async with conn.transaction():
        rows = await conn.fetch(
            """WITH candidates AS (SELECT id FROM push_deliveries
            WHERE (status='ticket' AND next_attempt_at<=now()) OR (status='checking' AND locked_at<now()-interval '5 minutes')
            ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1000)
            UPDATE push_deliveries d SET status='checking',receipt_attempts=d.receipt_attempts+1,locked_at=now(),updated_at=now()
            FROM candidates c WHERE d.id=c.id RETURNING d.*""",
        )
    if not rows:
        return False
    fresh = []
    for row in rows:
        if not row['accepted_at'] or row['accepted_at'] <= datetime.now(UTC) - timedelta(hours=24):
            await finish_receipt(conn, row, 'failed', 'ReceiptExpired')
        else:
            fresh.append(row)
    if not fresh:
        return True
    try:
        response = await client.post(f'{EXPO_BASE}/getReceipts', json={'ids': [row['ticket_id'] for row in fresh]}, headers=headers())
        response.raise_for_status()
        receipts = response.json().get('data')
        if not isinstance(receipts, dict):
            raise ValueError('Invalid push receipts')
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as error:
        for row in fresh:
            await finish_receipt(conn, row, 'ticket', type(error).__name__)
        return True
    for row in fresh:
        receipt = receipts.get(row['ticket_id'])
        if not isinstance(receipt, dict):
            await finish_receipt(conn, row, 'ticket', 'ReceiptPending')
        elif receipt.get('status') == 'ok':
            # FCM/APNs acceptance is not proof of display on a phone.
            await finish_receipt(conn, row, 'provider_accepted')
        else:
            details = receipt.get('details')
            code = details.get('error') if isinstance(details, dict) else None
            code = code if code in PERMANENT_ERRORS or code == 'MessageRateExceeded' else 'UnknownReceiptError'
            if code == 'DeviceNotRegistered':
                await disable_token(conn, row)
            retry = code == 'MessageRateExceeded' and row['attempts'] < MAX_ATTEMPTS
            await finish_receipt(conn, row, 'pending' if retry else 'failed', code, resend=retry)
    return True
