import secrets
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from .auth_security import rate_limit, token_digest
from .builtin_functions import require_user
from .config import Settings, get_settings
from .database import connect


router = APIRouter(prefix='/account', tags=['account'])
bearer = HTTPBearer(auto_error=False)


class DeletionCommand(BaseModel):
    confirmation: str
    reason: str = Field(default='', max_length=1000)


class DeletionReceipt(BaseModel):
    receipt_token: str = Field(min_length=32, max_length=128)


async def request_deletion(settings, user, command):
    if command.confirmation != 'DELETE':
        raise HTTPException(status_code=400, detail='Confirm account deletion before continuing.')
    await rate_limit(settings, f"account-delete:{user['id']}", 3, 3600)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await conn.fetchval('SELECT id FROM api_users WHERE id=$1 FOR UPDATE', user['id'])
            allowed = {value.strip() for value in settings.admin_user_ids.split(',') if value.strip()}
            if user['id'] in allowed and not await conn.fetchval("SELECT EXISTS(SELECT 1 FROM api_users WHERE id=ANY($1::text[]) AND id<>$2 AND coalesce(metadata->>'deletion_status','')='')", list(allowed), user['id']):
                raise HTTPException(status_code=409, detail='Assign another administrator before deleting the administrator account.')
            active = await conn.fetchrow("SELECT id,status FROM account_deletion_requests WHERE created_by=$1 AND status IN ('pending','processing','blocked') ORDER BY created_at DESC LIMIT 1", user['id'])
            if active:
                return {'id': active['id'], 'status': active['status'], 'already_requested': True}
            receipt = secrets.token_urlsafe(48)
            request_id = str(uuid.uuid4())
            await conn.execute("INSERT INTO account_deletion_requests(id,created_by,user_id,reason,status,receipt_hash) VALUES ($1,$2,$2,$3,'pending',$4)",
                               request_id, user['id'], command.reason, token_digest(receipt))
            await conn.execute("UPDATE api_users SET metadata=metadata || '{\"deletion_status\":\"pending\"}'::jsonb,updated_at=now() WHERE id=$1", user['id'])
            await conn.execute("UPDATE profiles SET deletion_status='pending',availability_status='offline' WHERE id=$1", user['id'])
            for table in ('photographers', 'models'):
                await conn.execute(f'UPDATE {table} SET is_online=false,is_available=false WHERE id=$1', user['id'])
            await conn.execute("INSERT INTO job_outbox(id,kind,payload,dedupe_key,status,attempts,max_attempts,available_at) VALUES ($1,'account_deletion',jsonb_build_object('request_id',$2::text),$3,'pending',0,16,now()) ON CONFLICT(dedupe_key) DO NOTHING",
                               str(uuid.uuid4()), request_id, f'account-delete:{request_id}')
            return {'id': request_id, 'status': 'pending', 'receipt_token': receipt, 'already_requested': False,
                    'message': 'Deletion is queued. Unresolved bookings, balances or legal holds must be resolved before cleanup. Financial records required for record keeping are retained without public profile data.'}
    finally:
        await conn.close()


@router.post('/deletion', status_code=202)
async def delete_account(command: DeletionCommand, settings: Annotated[Settings, Depends(get_settings)], credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    user = await require_user(settings, credentials.credentials if credentials else '')
    return await request_deletion(settings, user, command)


@router.post('/deletion/status')
async def deletion_status(command: DeletionReceipt, settings: Annotated[Settings, Depends(get_settings)]):
    conn = await connect(settings)
    try:
        row = await conn.fetchrow('SELECT id,status,blocked_reason,created_at,completed_at FROM account_deletion_requests WHERE receipt_hash=$1', token_digest(command.receipt_token))
        if not row:
            raise HTTPException(status_code=404, detail='Deletion receipt not found.')
        return dict(row)
    finally:
        await conn.close()
