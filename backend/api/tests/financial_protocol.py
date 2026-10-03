"""Real PostgreSQL + authenticated HTTP, with ONLY mocked money providers.

Run from backend/api: FINANCIAL_PROTOCOL_ALLOW_QA=true python -m tests.financial_protocol
Requires DATABASE_URL pointing at an explicitly *_qa_* loopback database with
pgcrypto already installed. Creates/removes its own isolated schema, applies baseline
migrations plus 008/012 there, and never creates provider acceptance evidence.
Not a bank settlement or launch capability test.

CI PostgreSQL 16: create an empty financial_qa_ci database, install pgcrypto in it,
set DATABASE_URL to its explicit loopback URL and FINANCIAL_PROTOCOL_ALLOW_QA=true,
then run this module with backend on PYTHONPATH. No provider credentials are needed.
"""

import asyncio
import base64
import json
import os
import re
import secrets
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

import asyncpg
import httpx
from cryptography.fernet import Fernet
from fastapi import FastAPI, HTTPException, Request

from app import financial_operations as financial
from app import local_auth
from app.config import Settings
from app.database import configure_connection
from app.local_auth import hash_password, token_digest


async def main():
    url = os.getenv('DATABASE_URL', '')
    parsed = urlsplit(url)
    database = unquote(parsed.path.removeprefix('/'))
    if (os.getenv('FINANCIAL_PROTOCOL_ALLOW_QA') != 'true'
            or parsed.scheme not in ('postgres', 'postgresql')
            or parsed.hostname not in ('127.0.0.1', 'localhost', '::1')
            or parsed.query or parsed.fragment
            or not re.fullmatch(r'[A-Za-z0-9_]+_qa_[A-Za-z0-9_]+', database)):
        raise RuntimeError('Explicit FINANCIAL_PROTOCOL_ALLOW_QA=true and a loopback *_qa_* PostgreSQL URL without query overrides are required.')
    schema = f'financial_qa_{secrets.token_hex(8)}'
    settings = Settings(_env_file=None, DATABASE_URL=url, ADMIN_USER_IDS='financial-admin', ALLOW_RUNTIME_SCHEMA_CHANGES=False,
        PAYFAST_MERCHANT_ID='unit-merchant', PAYFAST_PASSPHRASE='unit-only', PAYFAST_SANDBOX=True)
    config = financial.FinancialConfig(bank_encryption_key=Fernet.generate_key().decode(),
        stitch_client_id='unit-client', stitch_client_secret='unit-only', stitch_mode='sandbox',
        stitch_webhook_secret='whsec_' + base64.b64encode(b'x' * 32).decode())
    checks, posts, disbursements, refund_posts, refunds = [], [], {}, [], []
    tokens = {user: secrets.token_urlsafe(48) for user in ('financial-client', 'financial-creator', 'financial-admin', 'financial-outsider')}
    raw_connect = asyncpg.connect
    root = await raw_connect(url, command_timeout=20)
    report = None

    async def isolated_connection(_settings):
        connection = await raw_connect(url, command_timeout=20)
        await connection.execute(f'SET search_path TO "{schema}"')
        await configure_connection(connection)
        return connection

    async def user_dependency(request: Request):
        authorization = request.headers.get('authorization', '')
        if not authorization.startswith('Bearer '):
            raise HTTPException(401, 'Authentication required.')
        return await local_auth.user_from_access_token(settings, authorization[7:])

    application = FastAPI()
    application.include_router(financial.create_financial_router(lambda: settings, user_dependency, config))

    def gateway(request):
        if request.url.host == 'api.payfast.co.za':
            if request.url.path.startswith('/refunds/query/'):
                return httpx.Response(200, json={'amount_original': 10000, 'amount_available_for_refund': 10000,
                    'status': 'REFUNDABLE', 'refund_partial': {'method': 'PAYMENT_SOURCE'}})
            if request.method == 'POST':
                assert not refund_posts, 'Duplicate refund POST reached the mock gateway'
                refund_posts.append(str(request.url))
                refunds.append({'amount': -2000, 'date': '2026-10-03', 'type': 'Funds Received (Refund)'})
                raise httpx.ReadTimeout('Mocked refund reply lost', request=request)
            return httpx.Response(200, json={'code': 200, 'status': 'success', 'data': {'response': {
                'available_balance': 8000 if refunds else 10000, 'transactions': list(refunds)}}})
        if request.url.host == 'secure.stitch.money':
            return httpx.Response(200, json={'access_token': 'unit-only', 'token_type': 'Bearer', 'scope': 'client_disbursement'})
        if request.url.path == '/graphql':
            nonce = json.loads(request.content)['variables']['nonce']
            node = disbursements.get(nonce)
            return httpx.Response(200, json={'data': {'client': {'disbursements': {'edges': [{'node': {'id': node['id'], 'nonce': nonce}}] if node else []}}}})
        if request.method == 'POST' and request.url.path == '/v2/disbursements':
            document = json.loads(request.content)
            nonce = document['nonce']
            assert nonce not in disbursements, 'Duplicate transfer POST reached the mock gateway'
            posts.append(nonce)
            disbursements[nonce] = {**document, 'id': f'unit/{nonce}', 'status': 'completed'}
            # The provider accepted the transfer but its HTTP response was lost.
            raise httpx.ReadTimeout('Mocked provider reply lost', request=request)
        if request.method == 'GET' and request.url.path.startswith('/v2/disbursements/'):
            document = next(row for row in disbursements.values() if request.url.path.endswith(row['id']))
            return httpx.Response(200, json=document)
        raise AssertionError('Unexpected mock provider request')

    try:
        extension_schema = await root.fetchval("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'")
        if not extension_schema:
            raise RuntimeError('The QA database must already have pgcrypto installed; this harness does not install shared extensions.')
        crypto_namespace = '"' + extension_schema.replace('"', '""') + '"'
        await root.execute(f'CREATE SCHEMA "{schema}"')
        await root.execute(f'SET search_path TO "{schema}"')
        migrations = Path(__file__).resolve().parents[1] / 'migrations'
        for migration in sorted(migrations.glob('*.sql')):
            sequence = migration.name.split('_', 1)[0]
            if sequence <= '202610030006' or sequence in ('202610030008', '202610030012'):
                source = migration.read_text(encoding='utf-8')
                if sequence == '202610030004':
                    # Resolve the extension function without exposing public tables to DDL.
                    source = source.replace('digest(', f'{crypto_namespace}.digest(')
                await root.execute(source)
        await configure_connection(root)
        for user, token in tokens.items():
            role = 'photographer' if user == 'financial-creator' else 'client'
            await root.execute('INSERT INTO api_users(id,email,password_hash,metadata) VALUES ($1,$2,$3,$4::jsonb)',
                user, f'{user}@example.invalid', hash_password('QA-only-financial-2026!'), json.dumps({'role': role}))
            await root.execute("INSERT INTO profiles(id,role,verified,kyc_status) VALUES ($1,$2,true,'approved')", user, role)
            await root.execute("INSERT INTO api_sessions(access_token,refresh_token,user_id,expires_at,refresh_expires_at) VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '1 day')",
                token_digest(token), token_digest(secrets.token_urlsafe(48)), user)

        async def seed_booking(booking_id):
            await root.execute("""INSERT INTO bookings(id,client_id,photographer_id,status,payment_status,quote_amount,payout_amount,commission_amount,
                start_datetime,end_datetime) VALUES ($1,'financial-client','financial-creator','completed','paid',100,80,20,now()-interval '2 days',now()-interval '1 day')""", booking_id)
            await root.execute("INSERT INTO payments(id,booking_id,amount,currency,status,provider,provider_payment_id,merchant_id,provider_mode) VALUES ($1,$2,100,'ZAR','completed','payfast',$3,'unit-merchant','sandbox')", f'payment-{booking_id}', booking_id, f'unit-source-{booking_id}')
            await root.execute("INSERT INTO payment_events(id,payment_id,provider_event_id,event_type,payload) VALUES ($1,$2,$3,'complete','{}')", f'event-{booking_id}', f'payment-{booking_id}', f'unit-source-{booking_id}')
            await root.execute("INSERT INTO earnings(id,booking_id,user_id,amount,status) VALUES ($1,$2,'financial-creator',80,'pending')", f'earning-{booking_id}', booking_id)
            await root.execute("INSERT INTO payout_requests(id,booking_id,user_id,amount,status) VALUES ($1,$2,'financial-creator',80,'pending_delivery')", f'payout-{booking_id}', booking_id)

        await seed_booking('reservation-booking')
        await seed_booking('execution-booking')
        await seed_booking('refund-booking')
        with patch('app.financial_operations.connect', isolated_connection), patch('app.local_auth.connect', isolated_connection):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url='http://qa.internal') as client:
                async def check(name, method, path, expected, user=None, payload=None):
                    response = await client.request(method, path, headers={'authorization': f'Bearer {tokens[user]}'} if user else {}, json=payload)
                    checks.append({'name': name, 'status': response.status_code, 'passed': response.status_code == expected})
                    assert response.status_code == expected, f'{name}: unexpected HTTP {response.status_code}'
                    return response

                await check('Anonymous request rejected', 'POST', '/financial/payouts', 401, payload={})
                capability = (await check('Capabilities initially disabled', 'GET', '/financial/capabilities', 200, 'financial-client')).json()
                assert capability == {'refund_execution': False, 'creator_payout_execution': False}
                bank = (await check('Bank method stored privately', 'POST', '/financial/bank-methods', 200, 'financial-creator',
                    {'account_holder': 'QA Recipient', 'account_number': '1234567890', 'bank_id': 'absa', 'account_type': 'savings'})).json()
                assert 'account_number' not in bank and 'account_holder' not in bank
                encrypted = await root.fetchval('SELECT encrypted_details FROM financial_bank_accounts WHERE method_id=$1', bank['id'])
                assert b'1234567890' not in bytes(encrypted)
                await check('Creator cannot self-verify bank', 'POST', f"/financial/bank-methods/{bank['id']}/verify", 403, 'financial-creator', {'evidence_reference': 'unit-only/ownership-proof'})
                await check('Admin records independent bank review', 'POST', f"/financial/bank-methods/{bank['id']}/verify", 200, 'financial-admin', {'evidence_reference': 'unit-only/ownership-proof'})
                listed = (await check('Owner lists only masked methods', 'GET', '/financial/bank-methods', 200, 'financial-creator')).json()['methods']
                assert len(listed) == 1 and listed[0]['id'] == bank['id'] and listed[0]['verified']
                assert set(listed[0]) == {'id', 'bank_name', 'account_masked', 'verified', 'is_default'}
                await check('Owner selects verified default', 'POST', f"/financial/bank-methods/{bank['id']}/default", 200, 'financial-creator')
                assert await root.fetchval('SELECT is_default FROM payout_methods WHERE id=$1', bank['id'])
                await check('Cross-user default rejected', 'POST', f"/financial/bank-methods/{bank['id']}/default", 404, 'financial-outsider')
                await check('Cross-user revocation rejected', 'DELETE', f"/financial/bank-methods/{bank['id']}", 404, 'financial-outsider')
                await check('Pending legacy payout prevents revocation', 'DELETE', f"/financial/bank-methods/{bank['id']}", 409, 'financial-creator')
                await check('Unknown bank identifier rejected', 'POST', '/financial/bank-methods', 400, 'financial-client',
                    {'account_holder': 'QA Recipient', 'account_number': '1234567890', 'bank_id': 'foobar', 'account_type': 'savings'})

                # A committed deletion claim must win over a queued bank mutation.
                blocker = await isolated_connection(settings)
                mutation = None
                transaction = blocker.transaction()
                await transaction.start()
                try:
                    await blocker.execute("UPDATE api_users SET metadata=metadata || '{\"deletion_status\":\"processing\"}'::jsonb WHERE id='financial-outsider'")
                    mutation = asyncio.create_task(client.post('/financial/bank-methods',
                        headers={'authorization': f"Bearer {tokens['financial-outsider']}"},
                        json={'account_holder': 'QA Recipient', 'account_number': '1234567890', 'bank_id': 'absa', 'account_type': 'savings'}))
                    waiting = False
                    for _ in range(100):
                        waiting = await root.fetchval("""SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                            WHERE datname=current_database() AND wait_event_type='Lock'
                            AND query LIKE 'SELECT metadata FROM api_users WHERE id=%FOR UPDATE')""")
                        if waiting:
                            break
                        await asyncio.sleep(0.02)
                    assert waiting and not mutation.done(), 'Bank mutation did not wait for the account row lock'
                    await transaction.commit()
                    response = await asyncio.wait_for(mutation, 5)
                    assert response.status_code == 409
                    assert not await root.fetchval("SELECT EXISTS(SELECT 1 FROM financial_bank_accounts WHERE user_id='financial-outsider')")
                    checks.append({'name': 'Real account row lock prevents a deletion/bank-insert race', 'passed': True})
                finally:
                    if blocker.is_in_transaction():
                        await transaction.rollback()
                    if mutation and not mutation.done():
                        mutation.cancel()
                        await asyncio.gather(mutation, return_exceptions=True)
                    await blocker.close()
                await root.execute("UPDATE api_users SET metadata=metadata-'deletion_status' WHERE id='financial-outsider'")

                disposable = (await check('Create unreferenced client method', 'POST', '/financial/bank-methods', 200, 'financial-client',
                    {'account_holder': 'QA Recipient', 'account_number': '1234567890', 'bank_id': 'absa', 'account_type': 'savings'})).json()
                await check('Review unreferenced method', 'POST', f"/financial/bank-methods/{disposable['id']}/verify", 200, 'financial-admin', {'evidence_reference': 'unit-only/ownership-proof'})
                await check('Revocation removes unreferenced encrypted method', 'DELETE', f"/financial/bank-methods/{disposable['id']}", 200, 'financial-client')
                assert not await root.fetchval('SELECT EXISTS(SELECT 1 FROM financial_bank_accounts WHERE method_id=$1)', disposable['id'])
                assert not await root.fetchval('SELECT EXISTS(SELECT 1 FROM payout_methods WHERE id=$1)', disposable['id'])
                review = (await check('Create independent rejection case', 'POST', '/financial/bank-methods', 200, 'financial-client',
                    {'account_holder': 'QA Recipient', 'account_number': '1234567890', 'bank_id': 'absa', 'account_type': 'savings'})).json()
                await check('Owner cannot reject as administrator', 'POST', f"/financial/bank-methods/{review['id']}/reject", 403, 'financial-client', {'reason': 'unit-only/independent-rejection'})
                await check('Admin rejection is audited and never verifies', 'POST', f"/financial/bank-methods/{review['id']}/reject", 200, 'financial-admin', {'reason': 'unit-only/independent-rejection'})
                decision = await root.fetchrow('SELECT review_decision,reviewed_by,verified_at,revoked_at FROM financial_bank_accounts WHERE method_id=$1', review['id'])
                assert decision['review_decision'] == 'rejected' and decision['reviewed_by'] == 'financial-admin'
                assert decision['verified_at'] is None and decision['revoked_at'] is not None
                body = {'booking_id': 'reservation-booking', 'amount': '50.00', 'method_id': bank['id'], 'idempotency_key': 'same-draft'}
                await check('Outsider reservation rejected', 'POST', '/financial/payouts', 403, 'financial-outsider', body)
                headers = {'authorization': f"Bearer {tokens['financial-creator']}"}
                responses = await asyncio.gather(*(client.post('/financial/payouts', headers=headers, json=body) for _ in range(8)))
                assert all(response.status_code == 200 for response in responses)
                assert len({response.json()['id'] for response in responses}) == 1
                checks.append({'name': 'Concurrent retries create one durable reservation', 'passed': True})
                await check('Key conflict rejected', 'POST', '/financial/payouts', 409, 'financial-creator', {**body, 'amount': '51.00'})
                await check('Overspend blocked by row locks', 'POST', '/financial/payouts', 409, 'financial-creator', {**body, 'idempotency_key': 'another', 'amount': '40.00'})
                row = responses[0].json()
                await check('Admin approves', 'POST', f"/financial/operations/{row['id']}/decide", 200, 'financial-admin', {'decision': 'approve', 'reference': 'unit-only/delivery-proof'})
                await check('Execution blocked without acceptance', 'POST', f"/financial/operations/{row['id']}/execute", 503, 'financial-admin')
                assert await root.fetchval('SELECT attempt_count FROM financial_operations WHERE id=$1', row['id']) == 0
                await check('Unattempted approval can be cancelled', 'POST', f"/financial/operations/{row['id']}/decide", 200, 'financial-admin', {'decision': 'reject', 'reference': 'unit-only/cancel-before-send'})

                operation = (await check('Create independent execution case', 'POST', '/financial/payouts', 200, 'financial-creator',
                    {**body, 'booking_id': 'execution-booking', 'idempotency_key': 'execution-case', 'amount': '20.00'})).json()
                await check('Execution case approved', 'POST', f"/financial/operations/{operation['id']}/decide", 200, 'financial-admin', {'decision': 'approve', 'reference': 'unit-only/delivery-proof'})
                async with httpx.AsyncClient(transport=httpx.MockTransport(gateway)) as provider_client:
                    # Test-only injection: no acceptance record is created or capability certified.
                    with patch('app.financial_operations._ready', return_value=True):
                        result = await financial.execute_operation(settings, config, {'id': 'financial-admin'}, operation['id'], client=provider_client)
                    assert result['status'] == 'unknown'
                    assert await root.fetchval('SELECT paid_amount FROM earnings WHERE booking_id=$1', 'execution-booking') == 0
                    assert await root.fetchval('SELECT count(*) FROM financial_ledger') == 0
                    await financial.execute_operation(settings, config, {'id': 'financial-admin'}, operation['id'], client=provider_client)
                    await asyncio.gather(*(financial.reconcile_operation(settings, config, {'id': 'financial-admin'}, operation['id'], client=provider_client) for _ in range(5)))
                    assert len(posts) == 1
                    assert await root.fetchval('SELECT paid_amount FROM earnings WHERE booking_id=$1', 'execution-booking') == Decimal('20.00')
                    assert await root.fetchval('SELECT count(*) FROM financial_ledger') == 1
                    disbursements[operation['id']]['status'] = 'reversed'
                    await financial.reconcile_operation(settings, config, {'id': 'financial-admin'}, operation['id'], client=provider_client)
                    await financial.reconcile_operation(settings, config, {'id': 'financial-admin'}, operation['id'], client=provider_client)
                    assert await root.fetchval('SELECT paid_amount FROM earnings WHERE booking_id=$1', 'execution-booking') == 0
                    assert await root.fetchval('SELECT count(*) FROM financial_ledger') == 2
                checks.append({'name': 'Mocked response loss/readback/reversal updates SQL ledger exactly once', 'passed': True, 'real_settlement': False})
                refund = (await check('Client reserves refund', 'POST', '/financial/refunds', 200, 'financial-client',
                    {'booking_id': 'refund-booking', 'amount': '20.00', 'reason': 'QA refund only', 'idempotency_key': 'refund-case'})).json()
                await check('Refund approved', 'POST', f"/financial/operations/{refund['id']}/decide", 200, 'financial-admin',
                    {'decision': 'approve', 'reference': 'unit-only/refund-proof'})
                async with httpx.AsyncClient(transport=httpx.MockTransport(gateway)) as provider_client:
                    with patch('app.financial_operations._ready', return_value=True):
                        result = await financial.execute_operation(settings, config, {'id': 'financial-admin'}, refund['id'], client=provider_client)
                    assert result['status'] == 'unknown'
                    assert await root.fetchval('SELECT refunded_amount FROM payments WHERE booking_id=$1', 'refund-booking') == 0
                    await financial.execute_operation(settings, config, {'id': 'financial-admin'}, refund['id'], client=provider_client)
                    await asyncio.gather(*(financial.reconcile_operation(settings, config, {'id': 'financial-admin'}, refund['id'], client=provider_client) for _ in range(5)))
                    assert len(refund_posts) == 1
                    assert await root.fetchval('SELECT refunded_amount FROM payments WHERE booking_id=$1', 'refund-booking') == Decimal('20.00')
                    assert await root.fetchval('SELECT refunded_amount FROM earnings WHERE booking_id=$1', 'refund-booking') == Decimal('16.00')
                    assert await root.fetchval('SELECT count(*) FROM financial_ledger') == 5
                checks.append({'name': 'Mocked refund response loss/readback reverses SQL balances exactly once', 'passed': True, 'real_settlement': False})
                await check('Operation status ownership enforced', 'GET', f"/financial/operations/{operation['id']}", 404, 'financial-outsider')
                await root.execute('DELETE FROM financial_bank_accounts WHERE method_id=$1', bank['id'])
                assert await root.fetchval('SELECT count(*) FROM financial_operations') == 3
                assert await root.fetchval('SELECT count(*) FROM financial_provider_acceptance') == 0
                assert (await client.get('/financial/capabilities', headers={'authorization': f"Bearer {tokens['financial-admin']}"})).json() == capability
                report = {'checks': checks, 'passed_checks': len(checks),
                    'postgres_version': await root.fetchval('SHOW server_version'),
                    'database_invariants': 'real PostgreSQL isolated QA schema', 'providers': 'mocked',
                    'real_settlement': False, 'acceptance_evidence_created': False, 'capabilities': capability}
    finally:
        try:
            await root.execute('SET search_path TO public')
            await root.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            remains = await root.fetchval('SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)', schema)
            if remains:
                raise RuntimeError('Owned financial fixture schema was not removed.')
            if report is not None:
                report['schema_cleanup_verified'] = True
        finally:
            await root.close()
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
