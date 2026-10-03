import json
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import httpx

from backend.worker.app.push_delivery import headers, reconcile_receipts, send_pending


class Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class Connection:
    def __init__(self, count=1):
        self.rows = {str(i): {'id': str(i), 'token_id': str(i), 'notification_id': 'event-1', 'expo_push_token': f'ExpoPushToken[token{i}]',
                             'status': 'pending', 'attempts': 0, 'receipt_attempts': 0, 'ticket_id': None, 'accepted_at': None} for i in range(count)}
        self.tokens = {row['token_id']: {'enabled': True, 'expo_push_token': row['expo_push_token']} for row in self.rows.values()}
        self.sql = []

    def transaction(self):
        return Transaction()

    async def fetch(self, sql):
        self.sql.append((sql, ()))
        receipts = "SET status='checking'" in sql
        state, next_state, counter = ('ticket', 'checking', 'receipt_attempts') if receipts else ('pending', 'sending', 'attempts')
        selected = []
        for row in self.rows.values():
            if row['status'] == state:
                row.update(status=next_state)
                row[counter] += 1
                selected.append(dict(row))
        return selected

    async def fetchrow(self, sql, key):
        if 'FROM push_tokens' in sql:
            return self.tokens.get(key)
        return {'title': 'Booking update', 'body': 'Ready', 'action_payload': {'booking_id': 'booking-1'}}

    async def execute(self, sql, *args):
        self.sql.append((sql, args))
        if 'UPDATE push_tokens' in sql:
            token = self.tokens.get(args[0])
            if token and token['expo_push_token'] == args[1]:
                token['enabled'] = False
            return
        row = self.rows[args[0]]
        receipt = "status='checking'" in sql
        counter = 'receipt_attempts' if receipt else 'attempts'
        if row[counter] != args[1] or row['status'] != ('checking' if receipt else 'sending'):
            return
        row.update(status=args[2], last_error=args[3])
        if receipt:
            if args[4]:
                row.update(ticket_id=None, accepted_at=None)
        else:
            row['ticket_id'] = args[4]
            if args[4]:
                row['accepted_at'] = datetime.now(UTC)


class PushDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def client(self, conn, responses, operation=send_pending):
        requests = []
        def respond(request):
            requests.append(request)
            item = responses.pop(0)
            if isinstance(item, Exception):
                raise item
            code, body = item
            return httpx.Response(code, json=body)
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            await operation(conn, client)
        return requests

    async def test_tickets_survive_restart_and_known_acceptance_is_not_resent(self):
        conn = Connection()
        sent = await self.client(conn, [(200, {'data': [{'status': 'ok', 'id': 'ticket-1'}]})])
        self.assertEqual(conn.rows['0']['status'], 'ticket')
        body = json.loads(sent[0].content)
        self.assertEqual(body[0]['data']['notification_id'], 'event-1')
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: self.fail('Known ticket was resent'))) as client:
            self.assertFalse(await send_pending(conn, client))
        self.assertTrue(any('attempts=$2' in sql for sql, _ in conn.sql))

    async def test_partial_batch_success_is_persisted_before_retrying_only_rejected_device(self):
        conn = Connection(2)
        await self.client(conn, [(200, {'data': [{'status': 'ok', 'id': 'accepted'}, {'status': 'error', 'details': {'error': 'MessageRateExceeded'}}]})])
        requests = await self.client(conn, [(200, {'data': [{'status': 'ok', 'id': 'second'}]})])
        self.assertEqual(len(json.loads(requests[0].content)), 1)
        self.assertEqual(conn.rows['0']['attempts'], 1)
        self.assertEqual(conn.rows['1']['attempts'], 2)

    async def test_transient_http_and_network_failures_retry_but_http400_is_terminal(self):
        for response in [(429, {}), (503, {}), httpx.ReadTimeout('private service details')]:
            conn = Connection()
            await self.client(conn, [response])
            self.assertEqual(conn.rows['0']['status'], 'pending')
            self.assertNotIn('private', conn.rows['0']['last_error'])
        conn = Connection()
        await self.client(conn, [(400, {'errors': ['bad']})])
        self.assertEqual(conn.rows['0']['status'], 'failed')

    async def test_device_rejection_disables_only_that_token(self):
        conn = Connection(2)
        await self.client(conn, [(200, {'data': [{'status': 'error', 'details': {'error': 'DeviceNotRegistered'}}, {'status': 'ok', 'id': 'good'}]})])
        self.assertFalse(conn.tokens['0']['enabled'])
        self.assertTrue(conn.tokens['1']['enabled'])
        self.assertEqual(conn.rows['0']['status'], 'failed')

    async def test_replaced_or_disabled_token_is_not_sent(self):
        conn = Connection()
        conn.tokens['0']['expo_push_token'] = 'ExpoPushToken[new-registration]'
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: self.fail('Replaced token was sent'))) as client:
            await send_pending(conn, client)
        self.assertTrue(conn.tokens['0']['enabled'])
        self.assertEqual(conn.rows['0']['last_error'], 'TokenDisabledOrReplaced')

    async def test_receipt_acceptance_is_not_labeled_phone_delivery(self):
        conn = Connection()
        await self.client(conn, [(200, {'data': [{'status': 'ok', 'id': 'ticket'}]})])
        requests = await self.client(conn, [(200, {'data': {'ticket': {'status': 'ok'}}})], reconcile_receipts)
        self.assertTrue(str(requests[0].url).endswith('/getReceipts'))
        self.assertEqual(conn.rows['0']['status'], 'provider_accepted')

    async def test_missing_receipt_and_receipt_network_error_never_resend_accepted_push(self):
        conn = Connection()
        await self.client(conn, [(200, {'data': [{'status': 'ok', 'id': 'ticket'}]})])
        for response in [(200, {'data': {}}), httpx.ReadTimeout('do not store this')]:
            await self.client(conn, [response], reconcile_receipts)
            self.assertEqual(conn.rows['0']['status'], 'ticket')
            self.assertEqual(conn.rows['0']['ticket_id'], 'ticket')
            self.assertEqual(conn.rows['0']['attempts'], 1)

    async def test_receipt_expiry_is_terminal_without_resending(self):
        conn = Connection()
        conn.rows['0'].update(status='ticket', ticket_id='old', accepted_at=datetime.now(UTC) - timedelta(hours=25))
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: self.fail('Expired receipt should not be queried'))) as client:
            await reconcile_receipts(conn, client)
        self.assertEqual(conn.rows['0']['last_error'], 'ReceiptExpired')

    async def test_receipt_device_not_registered_disables_device(self):
        conn = Connection()
        conn.rows['0'].update(status='ticket', ticket_id='ticket', accepted_at=datetime.now(UTC))
        await self.client(conn, [(200, {'data': {'ticket': {'status': 'error', 'details': {'error': 'DeviceNotRegistered'}}}})], reconcile_receipts)
        self.assertFalse(conn.tokens['0']['enabled'])
        self.assertEqual(conn.rows['0']['status'], 'failed')

    async def test_retry_budget_is_bounded(self):
        conn = Connection()
        conn.rows['0']['attempts'] = 8
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: self.fail('Exhausted delivery was sent'))) as client:
            await send_pending(conn, client)
        self.assertEqual(conn.rows['0']['status'], 'failed')

    def test_submit_expo_token_is_never_used_as_push_access_token(self):
        with patch.dict('os.environ', {'EXPO_TOKEN': 'submit-only'}, clear=True):
            self.assertNotIn('Authorization', headers())
