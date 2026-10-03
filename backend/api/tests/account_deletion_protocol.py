"""Real isolated PostgreSQL + authenticated HTTP, with only S3 mocked.

From backend/api, with backend also on PYTHONPATH:
ACCOUNT_DELETION_PROTOCOL_ALLOW_QA=true python -m tests.account_deletion_protocol

Requires explicit DATABASE_URL: a loopback *_qa_* database with pgcrypto already
installed, and no NEON_DATABASE_URL override. Never reads the repository .env.
Applies migrations 001-012 in a generated schema and removes that schema even on
failure. No external credentials, storage requests, payments or production writes.
This exercises the worker cleanup function, not the worker's job-claim scheduler
or production S3 erasure/retention guarantees.
"""

import asyncio
import json
import os
import re
import secrets
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

import asyncpg
import httpx
from fastapi import FastAPI

from app import account_deletion, auth_security, local_auth
from app.config import Settings, get_settings
from app.database import configure_connection
from app.local_auth import hash_password, token_digest
from shared import account_cleanup


OWNER = 'deletion-owner'
OTHER = 'deletion-other'
PARTNER = 'deletion-partner'


def qa_database_url(environ=None):
    environ = os.environ if environ is None else environ
    url = environ.get('DATABASE_URL', '')
    parsed = urlsplit(url)
    database = unquote(parsed.path.removeprefix('/'))
    if (environ.get('ACCOUNT_DELETION_PROTOCOL_ALLOW_QA') != 'true'
            or parsed.scheme not in ('postgres', 'postgresql')
            or parsed.hostname not in ('127.0.0.1', 'localhost', '::1')
            or parsed.query or parsed.fragment
            or not re.fullmatch(r'[A-Za-z0-9_]+_qa_[A-Za-z0-9_]+', database)
            or environ.get('NEON_DATABASE_URL')):
        raise RuntimeError('Explicit ACCOUNT_DELETION_PROTOCOL_ALLOW_QA=true, a loopback *_qa_* PostgreSQL URL without query overrides, and no NEON_DATABASE_URL are required.')
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise RuntimeError('A valid loopback PostgreSQL port is required.')
    return url


def protocol_failure(error):
    failure = {**getattr(error, 'protocol_report', {}), 'passed': False,
               'error_class': type(error).__name__, 'sqlstate': getattr(error, 'sqlstate', None)}
    if isinstance(error, asyncpg.UndefinedTableError):
        relation = getattr(error, 'table_name', None)
        if not relation:
            match = re.search(r'relation "([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)" does not exist', str(error))
            relation = match.group(1) if match else None
        if relation and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?', relation):
            failure['relation'] = relation
    elif isinstance(error, AssertionError):
        failure['detail'] = str(error)
    return failure


class MockS3:
    def __init__(self):
        self.objects = {
            bucket: {f'users/{OWNER}/private-{index}.bin' for index in range(2005 if bucket == 'avatars' else 1)}
            | {f'users/{OTHER}/private.bin'}
            for bucket in account_cleanup.MEDIA_BUCKETS
        }
        self.calls = []
        self.deleted = []
        self.fail_once = False

    def list_objects_v2(self, Bucket, Prefix, MaxKeys):
        assert Prefix == f'users/{OWNER}/', 'Cleanup crossed the owner namespace'
        self.calls.append(('list', Bucket, Prefix))
        keys = sorted(key for key in self.objects[Bucket] if key.startswith(Prefix))[:MaxKeys]
        return {'Contents': [{'Key': key} for key in keys]}

    def delete_objects(self, Bucket, Delete):
        keys = [item['Key'] for item in Delete['Objects']]
        assert all(key.startswith(f'users/{OWNER}/') for key in keys), 'Cleanup deleted another account object'
        self.calls.append(('delete', Bucket, len(keys)))
        fail = self.fail_once
        self.fail_once = False
        removed = keys[:len(keys) // 2] if fail else keys
        for key in removed:
            self.objects[Bucket].remove(key)
            self.deleted.append((Bucket, key))
        return {'Errors': [{'Key': keys[-1], 'Code': 'AccessDenied'}]} if fail else {}


async def run_protocol():
    url = qa_database_url()
    schema = f'account_deletion_qa_{secrets.token_hex(8)}'
    settings = Settings(_env_file=None, DATABASE_URL=url, NEON_DATABASE_URL='',
                        APP_ENV='qa', ADMIN_USER_IDS='', ALLOW_RUNTIME_SCHEMA_CHANGES=False)
    checks = []
    report = {'checks': checks, 'database_invariants': 'real PostgreSQL isolated QA schema',
              'storage': 'mock S3 client; real account media cleanup algorithm',
              'production_writes': False, 'external_provider_requests': False,
              'worker_scheduler_tested': False, 'schema_cleanup_verified': False}
    raw_connect = asyncpg.connect
    root = await raw_connect(url, command_timeout=20, timeout=10)
    created = False
    personal_tables = {}
    storage = MockS3()
    tokens = {actor: secrets.token_urlsafe(48) for actor in (OWNER, OTHER, PARTNER)}

    def verify(name, condition):
        checks.append({'name': name, 'passed': bool(condition)})
        if not condition:
            raise AssertionError(name)

    async def isolated_connection(_settings):
        conn = await raw_connect(url, command_timeout=20, timeout=10)
        try:
            await conn.execute(f'SET search_path TO "{schema}"')
            await configure_connection(conn)
            return conn
        except BaseException:
            await conn.close()
            raise

    async def seed_booking(booking_id, client, provider, status='completed'):
        await root.execute("""INSERT INTO bookings(id,client_id,photographer_id,status,payment_status,
            quote_amount,payout_amount,commission_amount,start_datetime,end_datetime,notes,
            user_latitude,user_longitude,provider_latitude,provider_longitude)
            VALUES ($1,$2,$3,$4,'paid',100,80,20,now()-interval '2 days',now()-interval '1 day',
            'Private booking note',-29.85,31.03,-29.86,31.04)""", booking_id, client, provider, status)

    async def other_snapshot():
        result = {}
        for table, field in {'api_users': 'id', 'profiles': 'id', 'api_sessions': 'user_id',
                             **personal_tables}.items():
            rows = await root.fetch(f'SELECT * FROM "{table}" WHERE "{field}"=$1 ORDER BY id', OTHER)
            result[table] = [dict(row) for row in rows]
        for table, row_id in (('posts', 'other-post'), ('stories', 'other-story'),
                              ('reviews', 'other-review'), ('messages', 'other-private-message'),
                              ('bookings', 'other-booking'), ('payout_methods', 'other-bank')):
            result[table + '-unrelated'] = dict(await root.fetchrow(f'SELECT * FROM "{table}" WHERE id=$1', row_id))
        return result

    try:
        extension = await root.fetchval("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'")
        if not extension:
            raise RuntimeError('QA pgcrypto must already be installed; shared extensions are not installed by this harness.')
        crypto_schema = '"' + extension.replace('"', '""') + '"'
        await root.execute(f'CREATE SCHEMA "{schema}"')
        created = True
        await root.execute(f'SET search_path TO "{schema}"')
        migrations = Path(__file__).resolve().parents[1] / 'migrations'
        applied = []
        for migration in sorted(migrations.glob('*.sql')):
            sequence = migration.name.split('_', 1)[0]
            if '202610030001' <= sequence <= '202610030012':
                # Qualify pgcrypto only; never resolve DDL against existing public tables.
                source = migration.read_text(encoding='utf-8').replace('digest(', f'{crypto_schema}.digest(')
                await root.execute(source)
                applied.append(sequence)
        verify('All migrations 001-012 applied in the isolated schema',
               applied == [f'20261003{index:04d}' for index in range(1, 13)])
        await configure_connection(root)
        schema_tables = {row['table_name'] for row in await root.fetch(
            "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'")}
        personal_tables = {table: field for table, field in account_cleanup.PERSONAL_ROWS.items() if table in schema_tables}
        report['personal_tables_tested'] = sorted(personal_tables)
        report['absent_legacy_personal_tables'] = sorted(account_cleanup.PERSONAL_ROWS.keys() - schema_tables)
        # Legacy optional tables must not be invented by a current-schema fixture.
        # The real worker still executes unmocked SQL and must tolerate their absence.
        for actor in tokens:
            await root.execute('INSERT INTO api_users(id,email,password_hash,metadata) VALUES ($1,$2,$3,$4::jsonb)',
                               actor, f'{actor}@example.invalid', hash_password('QA-only-deletion-2026!'),
                               json.dumps({'role': 'photographer', 'full_name': f'Private {actor}'}))
            await root.execute("""INSERT INTO profiles(id,role,full_name,email,phone,bio,city,avatar_url,
                contact_details,date_of_birth,push_token,verified,age_verified,kyc_status,availability_status)
                VALUES ($1,'photographer',$2,$3,'+27000000000','Private bio','Private city',$4,
                '{"private":"contact"}','1990-01-01','private-device-token',true,true,'approved','online')""",
                               actor, f'Private {actor}', f'{actor}@example.invalid', f'avatars::users/{actor}/private.bin')
            await root.execute("INSERT INTO api_sessions(access_token,refresh_token,user_id,expires_at,refresh_expires_at) VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '1 day')",
                               token_digest(tokens[actor]), token_digest(secrets.token_urlsafe(48)), actor)
        for table, field in personal_tables.items():
            for actor in (OWNER, OTHER):
                row_id = actor if field == 'id' else f'{actor}-{table}'
                if field == 'id':
                    await root.execute(f'INSERT INTO "{table}"(id,is_online,is_available) VALUES ($1,true,true)', actor)
                else:
                    await root.execute(f'INSERT INTO "{table}"(id,"{field}") VALUES ($1,$2)', row_id, actor)
        for actor, prefix in ((OWNER, 'owner'), (OTHER, 'other')):
            await root.execute("INSERT INTO posts(id,author_id,caption,moderation_status) VALUES ($1,$2,'Private caption','approved')", f'{prefix}-post', actor)
            await root.execute("INSERT INTO stories(id,author_id,media_url) VALUES ($1,$2,$3)", f'{prefix}-story', actor, f'media::users/{actor}/story.bin')
            await root.execute("INSERT INTO reviews(id,reviewer_id,reviewee_id,client_id,photographer_id,rating,comment) VALUES ($1,$2,$3,$2,$3,5,'Private review')", f'{prefix}-review', actor, PARTNER)
            await root.execute("INSERT INTO payout_methods(id,user_id,account_holder,account_masked,bank_name,branch_code,verified) VALUES ($1,$2,'Private holder','****1234','Private bank','123456',true)", f'{prefix}-bank', actor)
            await root.execute("INSERT INTO financial_bank_accounts(method_id,user_id,encrypted_details,details_digest) VALUES ($1,$2,$3,'fixture-only')", f'{prefix}-bank', actor, b'not-real-bank-data')
        await root.execute("INSERT INTO post_comments(id,post_id,user_id,author_id,body) VALUES ('owner-comment','other-post',$1,$1,'Private comment')", OWNER)
        await root.execute("INSERT INTO post_comments(id,post_id,user_id,author_id,body) VALUES ('other-comment','other-post',$1,$1,'Other comment')", OTHER)
        for table in ('post_likes', 'post_unlocks'):
            await root.execute(f'INSERT INTO {table}(id,post_id,user_id) VALUES ($1,\'owner-post\',$2)', f'owner-{table}', OWNER)
        await root.execute("INSERT INTO follows(id,follower_id,following_id) VALUES ('owner-follow',$1,$2)", OWNER, OTHER)
        await root.execute("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES ('owner-block',$1,$2)", OWNER, PARTNER)
        await root.execute("INSERT INTO conversations(id,title,last_message) VALUES ('shared-conversation','Private title','Private preview')")
        for actor in (OWNER, OTHER):
            await root.execute("INSERT INTO conversation_participants(id,conversation_id,user_id) VALUES ($1,'shared-conversation',$2)", f'participant-{actor}', actor)
        await root.execute("INSERT INTO messages(id,conversation_id,sender_id,body,text,media_url,preview_url,audio_url) VALUES ('owner-message','shared-conversation',$1,'Private text','Private text','private-media','private-preview','private-audio')", OWNER)
        await root.execute("INSERT INTO messages(id,conversation_id,sender_id,body,reply_to_id,reply_preview) VALUES ('other-reply','shared-conversation',$1,'Other reply','owner-message','{\"text\":\"Private text\"}')", OTHER)
        await root.execute("INSERT INTO messages(id,sender_id,body) VALUES ('other-private-message',$1,'Other unrelated message')", OTHER)
        await root.execute("INSERT INTO message_reactions(id,message_id,user_id,emoji) VALUES ('owner-reaction','owner-message',$1,'fixture')", OTHER)
        await root.execute("INSERT INTO password_resets(id,user_id,token_hash,expires_at) VALUES ('owner-reset',$1,$2,now()+interval '1 hour')", OWNER, token_digest('fixture-reset-token'))
        await root.execute("INSERT INTO job_outbox(id,kind,payload,dedupe_key) VALUES ('owner-notification','notification',jsonb_build_object('user_id',$1::text),'owner-notification')", OWNER)
        await root.execute("INSERT INTO push_deliveries(id,job_id,token_id,notification_id,expo_push_token) VALUES ('owner-push','owner-notification',$1,$2,'ExponentPushToken[fixture-only]')", f'{OWNER}-push_tokens', f'{OWNER}-notification_events')
        await seed_booking('retained-booking', OTHER, OWNER)
        await seed_booking('other-booking', OTHER, PARTNER)
        await root.execute("INSERT INTO payments(id,booking_id,amount,status) VALUES ('retained-payment','retained-booking',100,'completed')")
        await root.execute("INSERT INTO earnings(id,booking_id,user_id,amount,status,paid_amount) VALUES ('retained-earning','retained-booking',$1,80,'paid',80)", OWNER)
        await root.execute("INSERT INTO payout_requests(id,booking_id,user_id,amount,status) VALUES ('retained-payout','retained-booking',$1,80,'paid')", OWNER)
        await root.execute("INSERT INTO credits_wallets(id,user_id,balance) VALUES ('owner-wallet',$1,0)", OWNER)
        await root.execute("""INSERT INTO financial_operations(id,kind,actor_id,user_id,booking_id,payment_id,amount,
            idempotency_key,request_fingerprint,reason,status,provider,proof)
            VALUES ('related-operation','refund',$1,$1,'retained-booking','retained-payment',20,
            'fixture-operation','fixture-only','Fixture settled refund','completed','payfast','{"fixture":true}')""", OTHER)
        await root.execute("INSERT INTO financial_ledger(id,operation_id,booking_id,user_id,entry_type,amount) VALUES ('retained-ledger','related-operation','retained-booking',$1,'customer_refund',-20)", OTHER)
        before_other = await other_snapshot()
        financial_rows = {table: [dict(row) for row in await root.fetch(f'SELECT * FROM {table} ORDER BY id')]
                          for table in ('payments', 'financial_ledger')}
        application = FastAPI()
        application.dependency_overrides[get_settings] = lambda: settings
        application.include_router(account_deletion.router)

        def media_cleanup(actor):
            return account_cleanup.delete_owned_media(actor, client=storage)

        with patch.object(account_deletion, 'connect', isolated_connection), \
                patch.object(auth_security, 'connect', isolated_connection), \
                patch.object(local_auth, 'connect', isolated_connection):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url='http://qa.internal') as client:
                async def http_check(name, path, expected, payload, actor=None):
                    headers = {'authorization': f'Bearer {tokens[actor]}'} if actor else {}
                    response = await client.post(path, headers=headers, json=payload)
                    verify(name, response.status_code == expected)
                    return response.json()

                await http_check('Anonymous deletion is rejected', '/account/deletion', 401, {'confirmation': 'DELETE'})
                await http_check('Confirmation is enforced before any queue write', '/account/deletion', 400, {'confirmation': 'NO'}, OWNER)
                request = await http_check('Authenticated owner queues deletion', '/account/deletion', 202,
                                           {'confirmation': 'DELETE', 'reason': 'Private fixture reason', 'user_id': OTHER, 'role': 'admin'}, OWNER)
                request_id, receipt = request['id'], request['receipt_token']
                stored = await root.fetchrow('SELECT * FROM account_deletion_requests WHERE id=$1', request_id)
                verify('Client IDs/roles cannot select another deletion owner', stored['created_by'] == OWNER and stored['user_id'] == OWNER)
                verify('Only a receipt digest is stored', stored['receipt_hash'] == token_digest(receipt) and receipt not in str(dict(stored)))
                responses = await asyncio.gather(*(client.post('/account/deletion', headers={'authorization': f'Bearer {tokens[OWNER]}'}, json={'confirmation': 'DELETE'}) for _ in range(2)))
                verify('Concurrent request retries reuse one request without reissuing its receipt',
                       all(row.status_code == 202 and row.json()['id'] == request_id and row.json()['already_requested']
                           and 'receipt_token' not in row.json() for row in responses))
                verify('Retry identity has one durable outbox job', await root.fetchval("SELECT count(*) FROM job_outbox WHERE kind='account_deletion' AND payload->>'request_id'=$1", request_id) == 1)
                verify('No other deletion request was created', await root.fetchval('SELECT count(*) FROM account_deletion_requests') == 1)
                verify('Queued deletion makes profile and provider offline',
                       await root.fetchval("SELECT availability_status='offline' FROM profiles WHERE id=$1", OWNER)
                       and all([await root.fetchval(f'SELECT is_online=false AND is_available=false FROM {table} WHERE id=$1', OWNER) for table in ('photographers', 'models')]))
                await http_check('Unknown receipt does not enumerate accounts', '/account/deletion/status', 404, {'receipt_token': 'x' * 48})

                async def status(expected):
                    result = await http_check(f'Receipt reports {expected}', '/account/deletion/status', 200, {'receipt_token': receipt})
                    verify(f'{expected} receipt status is accurate and excludes personal fields',
                           result['id'] == request_id and result['status'] == expected
                           and not {'created_by', 'user_id', 'reason', 'email', 'receipt_hash', 'receipt_token'} & result.keys())
                    return result

                await status('pending')
                payload = {'request_id': request_id}

                async def held(name):
                    verify(f'{name} prevents cleanup', not await account_cleanup.process_account_deletion(root, payload, media_cleanup))
                    result = await status('blocked')
                    verify(f'{name} is recorded without touching media or sessions',
                           name in result['blocked_reason'].split(',') and not storage.calls
                           and await root.fetchval('SELECT count(*) FROM api_sessions WHERE user_id=$1', OWNER) == 1)

                await seed_booking('open-booking', OTHER, OWNER, 'accepted')
                await held('open_bookings')
                await root.execute("UPDATE bookings SET status='cancelled' WHERE id='open-booking'")
                await root.execute("UPDATE earnings SET status='pending' WHERE id='retained-earning'")
                await held('unsettled_earnings')
                await root.execute("UPDATE earnings SET status='paid' WHERE id='retained-earning'")
                await root.execute("UPDATE payout_requests SET status='pending' WHERE id='retained-payout'")
                await held('pending_payouts')
                await root.execute("UPDATE payout_requests SET status='paid' WHERE id='retained-payout'")
                await root.execute("UPDATE credits_wallets SET balance=15 WHERE id='owner-wallet'")
                await held('wallet_balance')
                await root.execute("UPDATE credits_wallets SET balance=0 WHERE id='owner-wallet'")
                await root.execute("UPDATE financial_operations SET status='unknown',proof=NULL WHERE id='related-operation'")
                await held('pending_financial_operation')
                await root.execute("UPDATE financial_operations SET status='completed',proof='{\"fixture\":true}' WHERE id='related-operation'")
                await root.execute("INSERT INTO payment_incidents(id,booking_id,status) VALUES ('related-incident','retained-booking','open')")
                await held('pending_financial_operation')
                await root.execute("UPDATE payment_incidents SET status='closed' WHERE id='related-incident'")
                await root.execute("UPDATE account_deletion_requests SET legal_hold_until=now()+interval '1 day' WHERE id=$1", request_id)
                await held('active_legal_hold')
                await root.execute('UPDATE account_deletion_requests SET legal_hold_until=NULL WHERE id=$1', request_id)

                storage.fail_once = True
                try:
                    await account_cleanup.process_account_deletion(root, payload, media_cleanup)
                except RuntimeError as error:
                    verify('Partial S3 failure remains retryable, never completed', 'Some account media could not be deleted' in str(error))
                else:
                    raise AssertionError('Partial S3 failure falsely completed deletion')
                await status('processing')
                verify('Processing revokes sessions but does not falsely commit personal-data purge',
                       await root.fetchval('SELECT count(*) FROM api_sessions WHERE user_id=$1', OWNER) == 0
                       and await root.fetchval("SELECT count(*) FROM posts WHERE id='owner-post'") == 1)
                await http_check('Revoked owner cannot authenticate another deletion', '/account/deletion', 401, {'confirmation': 'DELETE'}, OWNER)
                verify('Retry completes actual worker SQL after partial media deletion', await account_cleanup.process_account_deletion(root, payload, media_cleanup))
                result = await status('completed')
                verify('Completion has a durable timestamp and no remaining hold', result['completed_at'] is not None and result['blocked_reason'] is None)
                profile = dict(await root.fetchrow('SELECT * FROM profiles WHERE id=$1', OWNER))
                verify('Tombstone keeps stable identity but erases nullable personal fields',
                       profile['full_name'] == 'Deleted account' and profile['deletion_status'] == 'completed'
                       and profile['availability_status'] == 'offline' and profile['kyc_status'] == 'deleted'
                       and profile['verified'] is False and profile['age_verified'] is False
                       and all(profile[field] is None for field in account_cleanup.PROFILE_PERSONAL_FIELDS & profile.keys()))
                owner = await root.fetchrow('SELECT * FROM api_users WHERE id=$1', OWNER)
                verify('Auth identity is disabled/anonymized without deleting retained references',
                       owner['metadata'] == {'deletion_status': 'completed'} and owner['email'].startswith('erased+')
                       and owner['password_hash'].startswith('disabled$') and owner['email_verified'] is False)
                for table, field in personal_tables.items():
                    verify(f'Owned {table} rows are erased', await root.fetchval(f'SELECT count(*) FROM "{table}" WHERE "{field}"=$1', OWNER) == 0)
                for table in ('posts', 'stories'):
                    verify(f'Owned {table} content is erased', await root.fetchval(f'SELECT count(*) FROM {table} WHERE author_id=$1', OWNER) == 0)
                verify('Actual reviews schema purges own review but preserves unrelated review',
                       await root.fetchval("SELECT count(*) FROM reviews WHERE id='owner-review'") == 0
                       and await root.fetchval("SELECT count(*) FROM reviews WHERE id='other-review'") == 1)
                verify('Comments, reactions, follows and blocks are erased',
                       await root.fetchval("SELECT count(*) FROM post_comments WHERE id='owner-comment'") == 0
                       and await root.fetchval("SELECT count(*) FROM post_comments WHERE id='other-comment'") == 1
                       and await root.fetchval("SELECT count(*) FROM message_reactions WHERE id='owner-reaction'") == 0
                       and await root.fetchval('SELECT count(*) FROM follows') == 0
                       and await root.fetchval('SELECT count(*) FROM user_blocks') == 0)
                message = await root.fetchrow("SELECT * FROM messages WHERE id='owner-message'")
                verify('Message tombstone removes body/media and other-user reply preview',
                       message['deleted_at'] is not None and all(message[field] is None for field in ('body', 'text', 'media_url', 'preview_url', 'audio_url', 'reply_preview'))
                       and await root.fetchval("SELECT reply_preview IS NULL FROM messages WHERE id='other-reply'"))
                verify('Remaining conversation membership stays intact without private title/preview',
                       await root.fetchval("SELECT count(*) FROM conversation_participants WHERE conversation_id='shared-conversation' AND user_id=$1", OTHER) == 1
                       and await root.fetchval("SELECT count(*) FROM conversation_participants WHERE user_id=$1", OWNER) == 0
                       and await root.fetchval("SELECT title='Conversation' AND last_message IS NULL FROM conversations WHERE id='shared-conversation'"))
                for table, predicate in (('password_resets', 'user_id=$1'), ('financial_bank_accounts', 'user_id=$1'),
                                         ('api_sessions', 'user_id=$1'), ('push_deliveries', "id='owner-push' AND $1::text IS NOT NULL")):
                    verify(f'Private {table} records are erased', await root.fetchval(f'SELECT count(*) FROM {table} WHERE {predicate}', OWNER) == 0)
                verify('Bank method tombstone removes identifying bank fields', await root.fetchval("SELECT account_holder IS NULL AND bank_name IS NULL AND account_masked IS NULL AND branch_code IS NULL AND verified=false FROM payout_methods WHERE id='owner-bank'"))
                verify('Retained booking removes notes and precise location', await root.fetchval("SELECT notes IS NULL AND user_latitude IS NULL AND user_longitude IS NULL AND provider_latitude IS NULL AND provider_longitude IS NULL FROM bookings WHERE id='retained-booking'"))
                for table, rows in financial_rows.items():
                    verify(f'Required {table} records remain unchanged', [dict(row) for row in await root.fetch(f'SELECT * FROM {table} ORDER BY id')] == rows)
                verify('Settled earnings/payout and zero wallet remain, with no invented transfers',
                       await root.fetchval("SELECT amount=80 AND status='paid' AND paid_amount=80 FROM earnings WHERE id='retained-earning'")
                       and await root.fetchval("SELECT amount=80 AND status='paid' FROM payout_requests WHERE id='retained-payout'")
                       and await root.fetchval("SELECT balance=0 FROM credits_wallets WHERE id='owner-wallet'")
                       and await root.fetchval('SELECT count(*) FROM financial_provider_acceptance') == 0)
                verify('Only own S3 prefix is erased across all batches/buckets',
                       all(objects == {f'users/{OTHER}/private.bin'} for objects in storage.objects.values())
                       and len(storage.deleted) == 2005 + len(account_cleanup.MEDIA_BUCKETS) - 1
                       and len(storage.deleted) == len(set(storage.deleted)))
                verify('Other account SQL rows and unrelated content are unchanged', await other_snapshot() == before_other)
                verify('Other account session still authenticates', (await local_auth.user_from_access_token(settings, tokens[OTHER]))['id'] == OTHER)
                completed = dict(await root.fetchrow('SELECT * FROM account_deletion_requests WHERE id=$1', request_id))
                media_calls = len(storage.calls)
                verify('Completed worker retry is a true no-op', await account_cleanup.process_account_deletion(root, payload, media_cleanup))
                verify('Completed retry changes neither receipt nor media',
                       dict(await root.fetchrow('SELECT * FROM account_deletion_requests WHERE id=$1', request_id)) == completed
                       and len(storage.calls) == media_calls)
                report['postgres_version'] = await root.fetchval('SHOW server_version')
                report['migrations_applied'] = applied
                report['passed_checks'] = len(checks)
    except Exception as error:
        report['passed_checks'] = sum(check['passed'] for check in checks)
        error.protocol_report = report
        raise
    finally:
        try:
            if created:
                await root.execute('SET search_path TO pg_catalog')
                await root.execute(f'DROP SCHEMA "{schema}" CASCADE')
                remains = await root.fetchval('SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)', schema)
                if remains:
                    raise RuntimeError('Owned account deletion fixture schema was not removed.')
                report['schema_cleanup_verified'] = True
        finally:
            await root.close()
    return report


if __name__ == '__main__':
    try:
        print(json.dumps(asyncio.run(run_protocol()), indent=2))
    except Exception as error:
        # Never include connection URLs, tokens or credentials in protocol output.
        print(json.dumps(protocol_failure(error), indent=2))
        raise SystemExit(1) from None
