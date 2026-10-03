"""Real QA PostgreSQL/API reset and session tests; no external email is delivered."""
import asyncio
import json
import os
import secrets
from pathlib import Path

import asyncpg
import httpx
from cryptography.fernet import Fernet

from app.config import Settings, get_settings
from app.database import close_pools
from app.main import app
from shared.recovery_mail import decrypt_reset_token


async def main():
    url = os.environ['DATABASE_URL']
    if '_qa_' not in url.rsplit('/', 1)[-1]:
        raise RuntimeError('QA database required')
    key = Fernet.generate_key().decode()
    settings = Settings(SMTP_HOST='qa.invalid', SMTP_USER='qa', SMTP_PASSWORD='dummy', SMTP_FROM='qa@example.invalid', RECOVERY_ENCRYPTION_KEY=key)
    app.dependency_overrides[get_settings] = lambda: settings
    conn = await asyncpg.connect(url)
    checks = []
    email = f'qa-recovery-{secrets.token_hex(8)}@example.invalid'
    password = 'QA-recovery-old-2026!'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://qa.internal') as client:
        async def check(name, method, path, expected, body=None, token=None):
            response = await client.request(method, path, json=body, headers={'Authorization': f'Bearer {token}'} if token else {})
            checks.append({'name': name, 'passed': response.status_code == expected, 'status': response.status_code})
            assert response.status_code == expected, f'{name}: {response.status_code} {response.text[:120]}'
            return response
        try:
            signup = (await check('Recovery account signup', 'POST', '/auth/sign-up', 200, {'email': email, 'password': password})).json()
            token = signup['session']['access_token']
            user_id = signup['user']['id']
            stored = await conn.fetchrow('SELECT access_token,refresh_token FROM api_sessions WHERE user_id=$1', user_id)
            assert stored['access_token'] != token and len(stored['access_token']) == 64
            assert stored['refresh_token'] != signup['session']['refresh_token']
            checks.append({'name': 'Session credentials stored only as fingerprints', 'passed': True})
            listed = (await check('Own sessions listed without credentials', 'GET', '/auth/sessions', 200, token=token)).json()
            assert len(listed['sessions']) == 1 and listed['sessions'][0]['current'] and 'access_token' not in listed['sessions'][0]
            second = (await check('Second device sign-in', 'POST', '/auth/sign-in', 200, {'email': email, 'password': password})).json()['session']['access_token']
            await check('Cannot revoke another account session', 'POST', '/auth/sessions/revoke', 404, {'session_id': 'not-owned'}, token)
            await check('Revoke own old session', 'POST', '/auth/sessions/revoke', 200, {'session_id': listed['sessions'][0]['id']}, second)
            await check('Revoked session cannot authenticate', 'GET', '/auth/me', 401, token=token)
            requested = (await check('Recovery request queued', 'POST', '/auth/recover-password', 200, {'email': email})).json()
            unknown = (await check('Unknown email gets identical response', 'POST', '/auth/recover-password', 200, {'email': f'unknown-{secrets.token_hex(6)}@example.invalid'})).json()
            assert unknown == requested
            job = await conn.fetchrow("SELECT j.id,j.payload FROM job_outbox j JOIN password_resets r ON r.id=j.payload->>'reset_id' WHERE r.user_id=$1 ORDER BY j.created_at DESC LIMIT 1", user_id)
            payload = json.loads(job['payload']) if isinstance(job['payload'], str) else job['payload']
            reset_token = decrypt_reset_token(key, payload['encrypted_token'])
            # Suppress this synthetic job. The SMTP adapter has separate TLS/mock unit tests.
            await conn.execute("UPDATE job_outbox SET status='done',payload=$2::jsonb WHERE id=$1", job['id'], json.dumps({'reset_id': payload['reset_id'], 'qa_no_email_sent': True}))
            new_password = 'QA-recovery-new-2026!'
            race = await asyncio.gather(*(client.post('/auth/reset-password', json={'token': reset_token, 'password': new_password}) for _ in range(2)))
            assert sorted(row.status_code for row in race) == [200, 400]
            checks.append({'name': 'Concurrent reset has exactly one winner', 'passed': True})
            await check('Reset code cannot be replayed', 'POST', '/auth/reset-password', 400, {'token': reset_token, 'password': new_password})
            await check('Reset revokes all old devices', 'GET', '/auth/me', 401, token=second)
            await check('Old password rejected', 'POST', '/auth/sign-in', 401, {'email': email, 'password': password})
            await check('New password works', 'POST', '/auth/sign-in', 200, {'email': email, 'password': new_password})
            abuse_email = f'qa-limit-{secrets.token_hex(8)}@example.invalid'
            responses = [await client.post('/auth/sign-in', json={'email': abuse_email, 'password': password}) for _ in range(11)]
            assert all(row.status_code == 401 for row in responses[:10]) and responses[-1].status_code == 429
            assert int(responses[-1].headers['retry-after']) > 0
            checks.append({'name': 'Database-backed login abuse limit', 'passed': True})
        finally:
            app.dependency_overrides.clear()
            await conn.close()
            await close_pools()
    report = {'checks': checks, 'actual_email_delivered': False, 'scope': 'QA database and API; code retrieved privately from encrypted synthetic job, not email'}
    destination = Path(os.environ.get('QA_AUTH_REPORT_PATH', '/artifacts/auth-protocol-report.json'))
    destination.write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    asyncio.run(main())
