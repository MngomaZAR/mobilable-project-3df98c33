import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .auth_security import rate_limit
from .config import Settings, get_settings
from .database import connect

router = APIRouter(tags=['moderation'])


class ReportInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    target_type: Literal['post', 'profile', 'booking', 'message']
    target_id: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=3, max_length=1000)
    details: str = Field(default='', max_length=4000)


async def create_report(settings: Settings, user: dict, command: ReportInput):
    owner = user['id']
    await rate_limit(settings, f'report:{owner}', 10, 3600)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            if command.target_type == 'post':
                visible = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM posts WHERE id=$1 AND (moderation_status='approved' OR author_id=$2))", command.target_id, owner)
            elif command.target_type == 'profile':
                visible = await conn.fetchval('SELECT EXISTS(SELECT 1 FROM profiles WHERE id=$1)', command.target_id)
            elif command.target_type == 'booking':
                visible = await conn.fetchval('SELECT EXISTS(SELECT 1 FROM bookings WHERE id=$1 AND (client_id=$2 OR photographer_id=$2 OR model_id=$2))', command.target_id, owner)
            else:
                # Chat reports may identify a message or its whole conversation.
                visible = await conn.fetchval('''SELECT EXISTS(SELECT 1 FROM conversation_participants p
                    WHERE p.user_id=$2 AND (p.conversation_id=$1 OR EXISTS(
                    SELECT 1 FROM messages m WHERE m.id=$1 AND m.conversation_id=p.conversation_id)))''', command.target_id, owner)
            if not visible:
                raise HTTPException(status_code=404, detail='Report target not found.')
            reason = command.reason.casefold()
            severity = 4 if any(word in reason for word in ['harass', 'abuse', 'threat', 'minor', 'violence', 'illegal']) else 3 if any(word in reason for word in ['fake', 'spam', 'scam']) else 2
            report_id, case_id = str(uuid.uuid4()), str(uuid.uuid4())
            await conn.execute('''INSERT INTO reports (id,created_by,reporter_id,target_type,target_id,reason,details,status)
                VALUES ($1,$2,$2,$3,$4,$5,$6,'open')''', report_id, owner, command.target_type, command.target_id, command.reason, command.details)
            await conn.execute('''INSERT INTO moderation_cases (id,reporter_id,target_type,target_id,reason,severity,status,sla_due_at)
                VALUES ($1,$2,$3,$4,$5,$6,'open',now()+make_interval(hours=>$7))''', case_id, owner, command.target_type, command.target_id, command.reason, str(severity), 6 if severity == 4 else 24)
            return {'report_id': report_id, 'case_id': case_id, 'status': 'open'}
    finally:
        await conn.close()


@router.post('/moderation/reports')
async def report(command: ReportInput, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    from .builtin_functions import require_user

    user = await require_user(settings, request.headers.get('Authorization', '').removeprefix('Bearer '))
    return await create_report(settings, user, command)
