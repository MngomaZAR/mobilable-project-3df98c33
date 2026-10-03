import asyncio
import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from cryptography.fernet import Fernet
from fastapi import HTTPException

from shared.recovery_mail import encrypt_reset_token
from .config import Settings
from .database import connect


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def rate_limit(settings: Settings, key: str, limit: int, seconds: int = 600) -> None:
    conn = await connect(settings)
    try:
        row = await conn.fetchrow(
            """INSERT INTO auth_rate_limits (key_hash,attempts,expires_at)
            VALUES ($1,1,now()+$2::int*interval '1 second')
            ON CONFLICT (key_hash) DO UPDATE SET
            attempts=CASE WHEN auth_rate_limits.expires_at<=now() THEN 1 ELSE auth_rate_limits.attempts+1 END,
            expires_at=CASE WHEN auth_rate_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE auth_rate_limits.expires_at END
            RETURNING attempts,expires_at""", token_digest(key), seconds,
        )
    finally:
        await conn.close()
    if row['attempts'] > limit:
        retry = max(1, int((row['expires_at'] - datetime.now(UTC)).total_seconds()))
        raise HTTPException(status_code=429, detail='Too many attempts. Please try again later.', headers={'Retry-After': str(retry)})


def recovery_configured(settings: Settings) -> bool:
    if not all([settings.smtp_host, settings.smtp_user, settings.smtp_password, settings.smtp_from, settings.recovery_encryption_key]):
        return False
    try:
        Fernet(settings.recovery_encryption_key.encode())
        return True
    except (ValueError, TypeError):
        return False


async def recover_password(settings: Settings, email: str) -> dict:
    from .local_auth import normalize_email
    email = normalize_email(email)
    await rate_limit(settings, f'recover:{email}', 3, 1800)
    if not recovery_configured(settings):
        raise HTTPException(status_code=503, detail='Password recovery email is not configured yet. Contact support.')
    token = secrets.token_urlsafe(32)
    encrypted = encrypt_reset_token(settings.recovery_encryption_key, token)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            user = await conn.fetchrow('SELECT id FROM api_users WHERE email=$1 FOR UPDATE', email)
            if user:
                reset_id = str(uuid.uuid4())
                await conn.execute('UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', user['id'])
                await conn.execute(
                    'INSERT INTO password_resets (id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)',
                    reset_id, user['id'], token_digest(token), datetime.now(UTC) + timedelta(minutes=30),
                )
                await conn.execute(
                    """INSERT INTO job_outbox (id,kind,payload,dedupe_key,status,attempts,max_attempts,available_at)
                    VALUES ($1,'password_recovery',$2::jsonb,$3,'pending',0,8,now())""",
                    str(uuid.uuid4()), json.dumps({'reset_id': reset_id, 'encrypted_token': encrypted}), f'reset:{reset_id}',
                )
    finally:
        await conn.close()
    return {'message': 'If this email is registered, a reset code will be sent. Check your inbox and spam folder.'}


async def reset_password(settings: Settings, token: str, password: str) -> dict:
    from .local_auth import hash_password, normalize_password
    if not 32 <= len(token) <= 128:
        raise HTTPException(status_code=400, detail='Invalid or expired reset code.')
    password_hash = await asyncio.to_thread(hash_password, normalize_password(password))
    conn = await connect(settings)
    try:
        async with conn.transaction():
            user_id = await conn.fetchval('SELECT user_id FROM password_resets WHERE token_hash=$1', token_digest(token))
            if not user_id:
                raise HTTPException(status_code=400, detail='Invalid or expired reset code.')
            await conn.fetchval('SELECT id FROM api_users WHERE id=$1 FOR UPDATE', user_id)
            row = await conn.fetchrow(
                'SELECT id FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE', token_digest(token),
            )
            if not row:
                raise HTTPException(status_code=400, detail='Invalid or expired reset code.')
            await conn.execute('UPDATE api_users SET password_hash=$2,updated_at=now() WHERE id=$1', user_id, password_hash)
            await conn.execute('UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', user_id)
            await conn.execute('DELETE FROM api_sessions WHERE user_id=$1', user_id)
    finally:
        await conn.close()
    return {'message': 'Password updated. Sign in with your new password.'}
