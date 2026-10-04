"""Protocol + real QA ledger tests. PayFast validation is deliberately mocked.

This proves database invariants, NOT an actual gateway payment or bank payout.
"""
import asyncio
import json
import os
import secrets
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit
from unittest.mock import patch

import asyncpg
import httpx

from app.config import Settings, get_settings
from app.database import close_pools
from app.main import app
from app.local_auth import create_session
from app.payments import signature
from tests.role_load import booking, headers


async def main():
    url = os.environ['DATABASE_URL']
    if '_qa_' not in url.rsplit('/', 1)[-1]:
        raise RuntimeError('QA database required')
    settings = Settings(API_PUBLIC_URL='https://qa.example.invalid', PAYFAST_MERCHANT_ID='QA-MOCK-MERCHANT', PAYFAST_MERCHANT_KEY='QA-MOCK-KEY', PAYFAST_PASSPHRASE='QA mock passphrase', PAYFAST_SANDBOX=True, PAYFAST_CHECKOUT_ENABLED=True)
    app.dependency_overrides[get_settings] = lambda: settings
    conn = await asyncpg.connect(url)
    results = []
    client_class = httpx.AsyncClient
    gateway_valid = True

    def validate(request):
        assert request.url.host == 'sandbox.payfast.co.za' and request.url.path == '/eng/query/validate'
        return httpx.Response(200, text='VALID' if gateway_valid else 'INVALID')

    def gateway_client(**kwargs):
        return client_class(transport=httpx.MockTransport(validate), **kwargs)

    async def actor(user_id):
        row = await conn.fetchrow('SELECT id,email,metadata FROM api_users WHERE id=$1', user_id)
        session = await create_session(settings, row)
        return {'id': user_id, 'token': session['access_token']}

    try:
        client_actor, provider = await actor('qa-client-0'), await actor('qa-photographer-0')
        async with client_class(transport=httpx.ASGITransport(app=app), base_url='http://qa.internal', timeout=30) as client:
            async def check(name, method, path, expected, user=None, body=None, content=None):
                response = await client.request(method, path, headers=headers(user) if user else {}, json=body, content=content)
                results.append({'name': name, 'passed': response.status_code == expected, 'status': response.status_code})
                assert response.status_code == expected, f'{name}: {response.status_code} {response.text[:200]}'
                return response

            row = (await check('Create quoted booking', 'POST', '/bookings', 200, client_actor, booking(client_actor, provider, f'protocol-{secrets.token_hex(12)}'))).json()
            booking_id = row['id']
            await check('Creator accepts', 'PATCH', f'/bookings/{booking_id}', 200, provider, {'status': 'accepted'})
            await check('Outsider checkout denied', 'POST', '/payments/checkout', 403, await actor('qa-model-0'), {'booking_id': booking_id})
            payment = (await check('Server amount checkout', 'POST', '/payments/checkout', 200, client_actor, {'booking_id': booking_id})).json()
            retry = (await check('Checkout retry reuses payment', 'POST', '/payments/checkout', 200, client_actor, {'booking_id': booking_id})).json()
            assert retry['paymentId'] == payment['paymentId']
            amount = parse_qs(urlsplit(payment['paymentUrl']).query)['amount'][0]
            assert amount == '1400.00'
            fields = {'merchant_id': settings.payfast_merchant_id, 'm_payment_id': payment['paymentId'], 'pf_payment_id': f'QA-MOCK-{secrets.token_hex(8)}', 'amount_gross': amount, 'payment_status': 'COMPLETE'}

            def notification(values):
                return urlencode({**values, 'signature': signature(values, settings.payfast_passphrase)}).encode()

            with patch('app.payments.httpx.AsyncClient', gateway_client):
                await check('Invalid signature rejected', 'POST', '/payments/payfast/itn', 400, content=urlencode({**fields, 'signature': 'forged'}).encode())
                await check('Underpayment rejected', 'POST', '/payments/payfast/itn', 400, content=notification({**fields, 'amount_gross': '1.00'}))
                gateway_valid = False
                await check('Gateway INVALID rejected', 'POST', '/payments/payfast/itn', 400, content=notification(fields))
                gateway_valid = True
                await check('Mock-validated payment persisted', 'POST', '/payments/payfast/itn', 200, content=notification(fields))
                await asyncio.gather(*(check('Duplicate callback acknowledged', 'POST', '/payments/payfast/itn', 200, content=notification(fields)) for _ in range(10)))
            assert await conn.fetchval('SELECT count(*) FROM payment_events WHERE payment_id=$1', payment['paymentId']) == 1
            assert await conn.fetchval('SELECT payment_status FROM bookings WHERE id=$1', booking_id) == 'paid'
            await check('Future paid shoot cannot complete', 'PATCH', f'/bookings/{booking_id}', 409, provider, {'status': 'completed'})
            await check('Future paid shoot cannot share live location early', 'POST', f'/bookings/{booking_id}/location', 409, provider, {'latitude': -29.85, 'longitude': 31.03, 'accuracy_m': 12.0})
            # Advance only the synthetic fixture into its permitted paid tracking window.
            await conn.execute("UPDATE bookings SET start_datetime=now()-interval '30 minutes',end_datetime=now()+interval '30 minutes' WHERE id=$1 AND client_id='qa-client-0'", booking_id)
            for participant in [client_actor, provider]:
                await check('Paid participant shares private live fix', 'POST', f'/bookings/{booking_id}/location', 200, participant, {'latitude': -29.85, 'longitude': 31.03, 'accuracy_m': 12.0})
            live = (await check('Participants receive both fresh locations', 'GET', f'/bookings/{booking_id}/location', 200, client_actor)).json()
            assert {fix['role'] for fix in live['locations']} == {'client', 'provider'}
            await check('Outsider cannot read paid tracking', 'GET', f'/bookings/{booking_id}/location', 403, await actor('qa-model-0'))
            await conn.execute("UPDATE location_tracks SET created_at=now()-interval '6 minutes' WHERE booking_id=$1", booking_id)
            stale = (await check('Stale locations disappear instead of displaying fabricated coordinates', 'GET', f'/bookings/{booking_id}/location', 200, client_actor)).json()
            assert stale['locations'] == []
            # Advance only the synthetic QA fixture, never a real booking.
            await conn.execute("UPDATE bookings SET start_datetime=now()-interval '2 hours',end_datetime=now()-interval '1 hour' WHERE id=$1 AND client_id='qa-client-0'", booking_id)
            await check('Completed shoot records pending earnings', 'PATCH', f'/bookings/{booking_id}', 200, provider, {'status': 'completed'})
            await check('Completion retry is idempotent', 'PATCH', f'/bookings/{booking_id}', 200, provider, {'status': 'completed'})
            await check('Completed booking stops location sharing', 'GET', f'/bookings/{booking_id}/location', 409, client_actor)
            ledger = await conn.fetchrow('SELECT amount,status FROM earnings WHERE booking_id=$1', booking_id)
            assert float(ledger['amount']) == 1120 and ledger['status'] == 'pending'
            assert await conn.fetchval('SELECT count(*) FROM payout_requests WHERE booking_id=$1', booking_id) == 1
            review = (await check('Client submits completed booking review', 'POST', '/reviews', 200, client_actor, {'booking_id': booking_id, 'rating': 5, 'comment': 'Synthetic QA review'})).json()
            assert review['moderation_status'] == 'pending'
    finally:
        await conn.close()
        await close_pools()
        app.dependency_overrides.clear()
        report = {'scope': 'Real QA PostgreSQL + FastAPI ASGI; mocked PayFast remote VALID response; no money transferred', 'checks': results, 'actual_gateway_payment_verified': False}
        output = Path(os.getenv('QA_PAYMENT_REPORT_PATH', '/artifacts/payment-protocol-report.json'))
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
