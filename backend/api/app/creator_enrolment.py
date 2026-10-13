import json
import uuid
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, ValidationError

from .config import Settings
from .database import connect


class CreatorEnrolment(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    role: Literal['photographer', 'model']
    accept_creator_policy: Literal[True]
    policy_version: Literal['2026-10-13']


async def enrol_creator(settings: Settings, user: dict, payload: dict) -> dict:
    if not user or not user.get('id'):
        raise HTTPException(401, 'Authentication is required.')
    if payload.get('accept_creator_policy') is not True:
        raise HTTPException(400, 'Accept the Creator Policy before applying.')
    try:
        command = CreatorEnrolment.model_validate(payload)
    except ValidationError:
        raise HTTPException(400, 'Choose photographer or model and accept the current Creator Policy.') from None
    owner = str(user['id'])
    conn = await connect(settings)
    try:
        async with conn.transaction():
            account = await conn.fetchrow('SELECT metadata FROM api_users WHERE id=$1 FOR UPDATE', owner)
            if not account:
                raise HTTPException(404, 'Account not found.')
            metadata = account['metadata'] or {}
            if isinstance(metadata, str):
                metadata = json.loads(metadata)
            if metadata.get('deletion_status'):
                raise HTTPException(409, 'Creator applications are unavailable while account deletion is pending.')
            profile = await conn.fetchrow('SELECT role,full_name,city,verified,kyc_status,age_verified FROM profiles WHERE id=$1 FOR UPDATE', owner)
            if not profile:
                raise HTTPException(404, 'Profile not found.')
            if profile['role'] == command.role:
                return {'role': command.role, 'kyc_status': profile['kyc_status'], 'approved': profile['verified'] is True and profile['kyc_status'] == 'approved' and profile['age_verified'] is True}
            if profile['role'] != 'client':
                raise HTTPException(409, 'Changing an existing creator or organisation role requires support review.')
            if not (profile['full_name'] or '').strip() or not (profile['city'] or '').strip():
                raise HTTPException(400, 'Save your full name and city before applying.')
            table = 'photographers' if command.role == 'photographer' else 'models'
            await conn.execute(f'''INSERT INTO {table} (id,name,rating,review_count,is_online)
                VALUES ($1,$2,0,0,false) ON CONFLICT (id) DO NOTHING''', owner, profile['full_name'])
            await conn.execute('''UPDATE profiles SET role=$2,verified=false,kyc_status='pending',
                availability_status='offline',updated_at=now() WHERE id=$1''', owner, command.role)
            await conn.execute('''UPDATE api_users SET metadata=coalesce(metadata,'{}'::jsonb)
                || jsonb_build_object('role',$2::text),updated_at=now() WHERE id=$1''', owner, command.role)
            context = json.dumps({'source': 'creator_enrolment', 'role': command.role})
            await conn.execute('''INSERT INTO consent_events
                (id,user_id,consent_type,legal_basis,consent_version,enabled,context,captured_at)
                VALUES ($1,$2,'creator_policy','contract',$3,true,$4::jsonb,now())''',
                str(uuid.uuid4()), owner, command.policy_version, context)
            await conn.execute('''INSERT INTO user_consents
                (id,user_id,consent_type,granted,accepted,version,legal_basis,metadata,granted_at,accepted_at)
                VALUES ($1,$2,'creator_policy',true,true,$3,'contract',$4::jsonb,now(),now())
                ON CONFLICT (id) DO UPDATE SET granted=true,accepted=true,version=excluded.version,
                metadata=excluded.metadata,granted_at=now(),accepted_at=now()''',
                f'{owner}:creator_policy', owner, command.policy_version, context)
            return {'role': command.role, 'kyc_status': 'pending', 'approved': False}
    finally:
        await conn.close()
