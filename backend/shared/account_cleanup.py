import asyncio
import json
import os
import secrets
import uuid

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


MEDIA_BUCKETS = ('avatars', 'post-images', 'chat-media', 'media', 'kyc-documents', 'papzi-media')
PERSONAL_ROWS = {
    'notification_events': 'user_id', 'notification_preferences': 'user_id',
    'push_tokens': 'user_id', 'device_tokens': 'user_id', 'kyc_documents': 'user_id',
    'user_consents': 'user_id', 'consent_events': 'user_id', 'analytics_events': 'user_id',
    'crash_logs': 'user_id', 'media_assets': 'owner_id', 'photographer_equipment': 'photographer_id',
    'availability': 'user_id', 'blocked_dates': 'user_id', 'model_services': 'model_id',
    'post_bookmarks': 'user_id', 'media_access_logs': 'user_id', 'tip_goals': 'creator_id',
    'location_tracks': 'user_id', 'support_tickets': 'created_by',
    'photographers': 'id', 'models': 'id',
}
OPTIONAL_PERSONAL_TABLES = frozenset(('notification_preferences', 'device_tokens'))
PROFILE_PERSONAL_FIELDS = {
    'email', 'phone', 'bio', 'contact_details', 'avatar_url', 'city', 'province', 'country',
    'name', 'gender', 'instagram', 'website', 'username', 'date_of_birth', 'push_token',
    'latitude', 'longitude', 'preferences', 'privacy', 'age_verified_at',
}


async def personal_row_tables(conn):
    rows = await conn.fetch("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=ANY($1::text[])", list(PERSONAL_ROWS))
    columns = {}
    for row in rows:
        columns.setdefault(row['table_name'], set()).add(row['column_name'])
    available = {}
    for table, owner in PERSONAL_ROWS.items():
        if table not in columns and table in OPTIONAL_PERSONAL_TABLES:
            continue
        if owner not in columns.get(table, set()):
            raise RuntimeError('Required account cleanup schema is unavailable.')
        available[table] = owner
    return available


async def financial_hold_reasons(conn, user_id):
    checks = {
        'open_bookings': "SELECT EXISTS(SELECT 1 FROM bookings WHERE (client_id=$1 OR photographer_id=$1 OR model_id=$1) AND coalesce(status,'pending') NOT IN ('completed','cancelled','rejected'))",
        'unsettled_earnings': "SELECT EXISTS(SELECT 1 FROM earnings WHERE user_id=$1 AND amount>0 AND coalesce(status,'pending') NOT IN ('paid','refunded','cancelled'))",
        'pending_payouts': "SELECT EXISTS(SELECT 1 FROM payout_requests WHERE user_id=$1 AND coalesce(status,'pending') NOT IN ('paid','completed','cancelled','rejected','failed'))",
        'wallet_balance': 'SELECT EXISTS(SELECT 1 FROM credits_wallets WHERE user_id=$1 AND coalesce(balance,0)<>0)',
    }
    reasons = [name for name, sql in checks.items() if await conn.fetchval(sql, user_id)]
    for table in ('payment_refunds', 'refund_requests', 'refund_operations', 'financial_operations', 'payment_incidents'):
        columns = {row['column_name'] for row in await conn.fetch(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1", table,
        )}
        if 'status' not in columns:
            continue
        predicates = [f'"{column}"=$1' for column in ('user_id', 'actor_id', 'requested_by', 'created_by', 'provider_id') if column in columns]
        if 'booking_id' in columns:
            predicates.append('booking_id IN (SELECT id FROM bookings WHERE client_id=$1 OR photographer_id=$1 OR model_id=$1)')
        if predicates and await conn.fetchval(
            f"SELECT EXISTS(SELECT 1 FROM \"{table}\" WHERE ({' OR '.join(predicates)}) AND coalesce(status,'pending') NOT IN ('completed','paid','succeeded','cancelled','rejected','failed','resolved','closed','reversed'))", user_id,
        ):
            reasons.append('pending_financial_operation')
    return sorted(set(reasons))


def delete_owned_media(user_id, environ=None, client=None):
    environ = os.environ if environ is None else environ
    if not user_id or '/' in user_id or '\\' in user_id:
        raise ValueError('Invalid account media owner.')
    if client is None:
        if not all(environ.get(key) for key in ('MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY')):
            raise RuntimeError('Object storage is required to complete account deletion.')
        client = boto3.client('s3', endpoint_url=environ['MINIO_ENDPOINT'],
                              aws_access_key_id=environ['MINIO_ACCESS_KEY'], aws_secret_access_key=environ['MINIO_SECRET_KEY'],
                              region_name='us-east-1', config=Config(signature_version='s3v4', connect_timeout=5, read_timeout=30))
    removed = 0
    # Re-list from the beginning after each batch: deleting while paginating
    # must not skip objects on S3 implementations with offset-based cursors.
    for bucket in MEDIA_BUCKETS:
        for _ in range(1000):
            try:
                objects = client.list_objects_v2(Bucket=bucket, Prefix=f'users/{user_id}/', MaxKeys=1000).get('Contents', [])
            except ClientError as error:
                if error.response.get('Error', {}).get('Code') in {'NoSuchBucket', '404', 'NotFound'}:
                    break
                raise
            if not objects:
                break
            if any(not obj['Key'].startswith(f'users/{user_id}/') for obj in objects):
                raise RuntimeError('Storage returned an object outside the account namespace.')
            result = client.delete_objects(Bucket=bucket, Delete={'Objects': [{'Key': obj['Key']} for obj in objects], 'Quiet': True})
            if result.get('Errors'):
                raise RuntimeError('Some account media could not be deleted.')
            removed += len(objects)
        else:
            raise RuntimeError('Account deletion needs additional bounded storage batches.')
    return removed


async def process_account_deletion(conn, payload, media_cleanup=None):
    request_id = str(payload.get('request_id') or '')
    if not request_id:
        raise ValueError('A deletion request is required.')
    async with conn.transaction():
        request = await conn.fetchrow('SELECT * FROM account_deletion_requests WHERE id=$1 FOR UPDATE', request_id)
        if not request:
            raise ValueError('Unknown deletion request.')
        if request['status'] == 'completed':
            return True
        user_id = request['created_by']
        await conn.fetchval('SELECT id FROM api_users WHERE id=$1 FOR UPDATE', user_id)
        holds = await financial_hold_reasons(conn, user_id)
        if request.get('legal_hold_until') and await conn.fetchval('SELECT $1::timestamptz>now()', request['legal_hold_until']):
            holds.append('active_legal_hold')
        if holds:
            await conn.execute("UPDATE account_deletion_requests SET status='blocked',blocked_reason=$2,updated_at=now() WHERE id=$1", request_id, ','.join(holds))
            return False
        await conn.execute("UPDATE account_deletion_requests SET status='processing',blocked_reason=NULL,started_at=coalesce(started_at,now()),updated_at=now() WHERE id=$1", request_id)
        await conn.execute("UPDATE api_users SET metadata=metadata || '{\"deletion_status\":\"processing\"}'::jsonb,updated_at=now() WHERE id=$1", user_id)
        await conn.execute('DELETE FROM api_sessions WHERE user_id=$1', user_id)
        await conn.execute("UPDATE profiles SET deletion_status='processing',availability_status='offline',avatar_url=NULL WHERE id=$1", user_id)
    await asyncio.to_thread(media_cleanup or delete_owned_media, user_id)
    async with conn.transaction():
        await conn.fetchval('SELECT id FROM api_users WHERE id=$1 FOR UPDATE', user_id)
        await conn.execute("UPDATE messages SET reply_preview=NULL WHERE reply_to_id IN (SELECT id FROM messages WHERE sender_id=$1)", user_id)
        await conn.execute('DELETE FROM message_reactions WHERE user_id=$1 OR message_id IN (SELECT id FROM messages WHERE sender_id=$1)', user_id)
        await conn.execute("UPDATE messages SET body=NULL,text=NULL,media_url=NULL,preview_url=NULL,audio_url=NULL,reply_preview=NULL,deleted_at=now(),updated_at=now() WHERE sender_id=$1", user_id)
        await conn.execute("UPDATE conversations SET title='Conversation',last_message=NULL WHERE id IN (SELECT conversation_id FROM conversation_participants WHERE user_id=$1)", user_id)
        await conn.execute('DELETE FROM conversation_participants WHERE user_id=$1', user_id)
        for table in ('post_likes', 'post_bookmarks', 'post_comments', 'post_unlocks'):
            await conn.execute(f'DELETE FROM {table} WHERE user_id=$1 OR post_id IN (SELECT id FROM posts WHERE author_id=$1)', user_id)
        await conn.execute('DELETE FROM posts WHERE author_id=$1', user_id)
        await conn.execute('DELETE FROM stories WHERE author_id=$1', user_id)
        await conn.execute('DELETE FROM reviews WHERE reviewer_id=$1 OR reviewee_id=$1 OR client_id=$1 OR photographer_id=$1', user_id)
        await conn.execute('DELETE FROM follows WHERE follower_id=$1 OR following_id=$1', user_id)
        await conn.execute('DELETE FROM user_blocks WHERE blocker_id=$1 OR blocked_id=$1', user_id)
        for table, owner in (await personal_row_tables(conn)).items():
            await conn.execute(f'DELETE FROM "{table}" WHERE "{owner}"=$1', user_id)
        # Signed contract/dispatch history references the stable profile identity.
        # Keep only an inaccessible tombstone, never a public personal profile.
        fields = {row['column_name'] for row in await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='profiles' AND is_nullable='YES'")}
        assignments = [f'"{field}"=NULL' for field in sorted(PROFILE_PERSONAL_FIELDS & fields)]
        await conn.execute("UPDATE profiles SET full_name='Deleted account',deletion_status='completed',availability_status='offline',verified=false,age_verified=false,kyc_status='deleted',updated_at=now()" + (',' + ','.join(assignments) if assignments else '') + ' WHERE id=$1', user_id)
        await conn.execute('DELETE FROM password_resets WHERE user_id=$1', user_id)
        await conn.execute('DELETE FROM api_sessions WHERE user_id=$1', user_id)
        await conn.execute("DELETE FROM job_outbox WHERE kind='notification' AND payload->>'user_id'=$1", user_id)
        await conn.execute('UPDATE payout_methods SET bank_name=NULL,account_holder=NULL,account_masked=NULL,branch_code=NULL,verified=false WHERE user_id=$1', user_id)
        await conn.execute('DELETE FROM financial_bank_accounts WHERE user_id=$1', user_id)
        await conn.execute('UPDATE bookings SET notes=NULL,user_latitude=NULL,user_longitude=NULL,provider_latitude=NULL,provider_longitude=NULL WHERE client_id=$1 OR photographer_id=$1 OR model_id=$1', user_id)
        await conn.execute('UPDATE api_users SET email=$2,password_hash=$3,metadata=$4::jsonb,email_verified=false,updated_at=now() WHERE id=$1',
                           user_id, f'erased+{uuid.uuid4()}@example.invalid', f'disabled${secrets.token_hex(32)}', json.dumps({'deletion_status': 'completed'}))
        await conn.execute("UPDATE account_deletion_requests SET status='completed',reason=NULL,blocked_reason=NULL,completed_at=now(),updated_at=now() WHERE id=$1", request_id)
    return True
