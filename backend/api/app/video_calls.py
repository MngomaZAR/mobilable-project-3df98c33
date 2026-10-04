import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException

from .config import Settings
from .database import connect
from .booking_engine import enqueue
from .service_acceptance import canary_active, require_access


TOKEN_TTL = timedelta(seconds=120)
ROOM_TTL = timedelta(hours=1)
PHYSICAL_SERVICES = {'photography', 'modeling', 'combined'}


def livekit_sdk():
    try:
        from livekit import api
        return api
    except ImportError as error:
        raise HTTPException(status_code=503, detail='Live video SDK is unavailable.') from error


def require_configuration(settings: Settings, *, cleanup=False):
    url = urlparse(settings.livekit_url)
    if ((not cleanup and not getattr(settings, 'livekit_enabled', False) and not canary_active(settings))
            or not settings.livekit_api_key or not settings.livekit_api_secret):
        raise HTTPException(status_code=503, detail='Booking video calls are not enabled.')
    local_qa = getattr(settings, 'app_env', 'production') in {'development', 'test'} and url.hostname in {'localhost', '127.0.0.1', '::1'} and url.scheme == 'ws'
    if (url.scheme != 'wss' and not local_qa) or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise HTTPException(status_code=503, detail='A secure LiveKit endpoint is required.')
    return livekit_sdk()


def identifier(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 120 or value != value.strip() or '\x00' in value:
        raise HTTPException(status_code=400, detail=f'A valid {name} is required.')
    return value


def booking_participants(booking, user: dict[str, Any]) -> set[str]:
    members = {booking[key] for key in ('client_id', 'photographer_id', 'model_id') if booking[key]}
    if user.get('id') not in members:
        raise HTTPException(status_code=403, detail='Only booking participants may use this call.')
    return members


def _client(settings, api):
    from aiohttp import ClientTimeout

    return api.LiveKitAPI(
        getattr(settings, 'livekit_api_url', '') or settings.livekit_url,
        api_key=settings.livekit_api_key, api_secret=settings.livekit_api_secret,
        timeout=ClientTimeout(total=8),
    )


async def queue_room_end(conn, session_id: str, available_at: datetime):
    await conn.execute(
        """INSERT INTO job_outbox (id,kind,payload,dedupe_key,status,attempts,max_attempts,available_at)
        VALUES ($1,'livekit_room_end',$2::jsonb,$3,'pending',0,12,$4)
        ON CONFLICT (dedupe_key) DO UPDATE SET available_at=LEAST(job_outbox.available_at,EXCLUDED.available_at),
        status=CASE WHEN job_outbox.status IN ('done','failed') THEN 'pending' ELSE job_outbox.status END,
        attempts=CASE WHEN job_outbox.status IN ('done','failed') THEN 0 ELSE job_outbox.attempts END,
        updated_at=now()""",
        str(uuid.uuid4()), json.dumps({'session_id': session_id}), f'video-room-end:{session_id}', available_at,
    )


async def delete_livekit_room(settings, room_name: str, participants=()):
    api = livekit_sdk()
    async with _client(settings, api) as client:
        # Cloud supports a strict revocation cutoff; self-hosted still needs short TTLs.
        cutoff = int(datetime.now(UTC).timestamp()) + 1
        for identity in participants:
            try:
                await client.room.remove_participant(api.RoomParticipantIdentity(room=room_name, identity=identity, revoke_token_ts=cutoff))
            except api.TwirpError as error:
                if error.code != 'not_found':
                    raise
        try:
            await client.room.delete_room(api.DeleteRoomRequest(room=room_name))
        except api.TwirpError as error:
            if error.code != 'not_found':
                raise


async def handle_video_call(settings: Settings, user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    if set(payload) - {'action', 'booking_id', 'session_id'}:
        raise HTTPException(status_code=400, detail='Use a booking_id, not creator IDs, roles or room grants.')
    booking_id = identifier(payload.get('booking_id'), 'booking_id')
    action = payload.get('action', 'join')
    if action not in ('join', 'end'):
        raise HTTPException(status_code=400, detail='Unsupported video call action.')
    api = require_configuration(settings, cleanup=action == 'end')
    conn = await connect(settings)
    try:
        async with conn.transaction():
            booking = await conn.fetchrow('SELECT id,client_id,photographer_id,model_id,status,service_type FROM bookings WHERE id=$1 FOR UPDATE', booking_id)
            if not booking:
                raise HTTPException(status_code=404, detail='Booking not found.')
            members = booking_participants(booking, user)
            room = await conn.fetchrow('SELECT * FROM booking_video_rooms WHERE booking_id=$1 FOR UPDATE', booking_id)
            now = datetime.now(UTC)
            if action == 'end':
                session_id = identifier(payload.get('session_id'), 'session_id')
                if not room or room['id'] != session_id:
                    raise HTTPException(status_code=404, detail='Booking call not found.')
                if room['status'] == 'ended':
                    return {'sessionId': session_id, 'status': 'ended', 'cleanup_pending': False}
                await conn.execute("UPDATE booking_video_rooms SET status='ending',end_requested_at=coalesce(end_requested_at,now()),ended_by=$2,updated_at=now() WHERE id=$1", session_id, user['id'])
                await queue_room_end(conn, session_id, now)
            else:
                await require_access(settings, 'video_call_service', members, connection=conn)
                if booking['service_type'] not in PHYSICAL_SERVICES:
                    raise HTTPException(status_code=403, detail='Paid digital video is unavailable without compliant billing.')
                if booking['status'] not in ('accepted', 'in_progress') or len(members) < 2:
                    raise HTTPException(status_code=409, detail='An accepted booking with a provider is required.')
                if await conn.fetchval('SELECT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=ANY($2::text[])) OR (blocked_id=$1 AND blocker_id=ANY($2::text[])))', user['id'], sorted(members - {user['id']})):
                    raise HTTPException(status_code=403, detail='This booking call is unavailable.')
                if room and (room['status'] != 'open' or room['expires_at'] <= now):
                    raise HTTPException(status_code=409, detail='This booking call has ended or expired.')
                if not room:
                    session_id = str(uuid.uuid4())
                    room = await conn.fetchrow(
                        "INSERT INTO booking_video_rooms (id,booking_id,room_name,expires_at,source_revision) VALUES ($1,$2,$3,$4,$5) RETURNING *",
                        session_id, booking_id, f'papzii-booking-{uuid.uuid4().hex}', now + ROOM_TTL, getattr(settings, 'app_version', ''),
                    )
                    await queue_room_end(conn, room['id'], room['expires_at'])
        if action == 'end':
            # Persist the ending state and cleanup job before any remote operation.
            try:
                await delete_livekit_room(settings, room['room_name'], sorted(members))
            except Exception:
                return {'sessionId': room['id'], 'status': 'ending', 'cleanup_pending': True}
            await conn.execute("UPDATE booking_video_rooms SET status='ended',ended_at=coalesce(ended_at,now()),updated_at=now() WHERE id=$1", room['id'])
            return {'sessionId': room['id'], 'status': 'ended', 'cleanup_pending': False}

        # Recheck after the first commit; an end request may have won the lock.
        async with conn.transaction():
            booking = await conn.fetchrow('SELECT id,client_id,photographer_id,model_id,status,service_type FROM bookings WHERE id=$1 FOR UPDATE', booking_id)
            if not booking:
                raise HTTPException(status_code=404, detail='Booking not found.')
            members = booking_participants(booking, user)
            room = await conn.fetchrow('SELECT * FROM booking_video_rooms WHERE booking_id=$1 FOR UPDATE', booking_id)
            if booking['service_type'] not in PHYSICAL_SERVICES or len(members) < 2 or booking['status'] not in ('accepted', 'in_progress') or not room or room['status'] != 'open' or room['expires_at'] <= datetime.now(UTC):
                raise HTTPException(status_code=409, detail='This booking call is no longer available.')
            if await conn.fetchval('SELECT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=ANY($2::text[])) OR (blocked_id=$1 AND blocker_id=ANY($2::text[])))', user['id'], sorted(members - {user['id']})):
                raise HTTPException(status_code=403, detail='This booking call is unavailable.')
            await require_access(settings, 'video_call_service', members, connection=conn)
            try:
                async with _client(settings, api) as client:
                    await client.room.create_room(api.CreateRoomRequest(name=room['room_name'], empty_timeout=120, departure_timeout=30, max_participants=len(members)))
            except Exception as error:
                raise HTTPException(status_code=503, detail='The video room could not be reached. Try again later.') from error
            ttl = min(TOKEN_TTL, room['expires_at'] - datetime.now(UTC))
            if ttl.total_seconds() <= 0:
                raise HTTPException(status_code=409, detail='This booking call has expired.')
            access = api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret).with_identity(user['id']).with_ttl(ttl)
            access.with_grants(api.VideoGrants(room_join=True, room=room['room_name'], can_publish=True, can_subscribe=True,
                                              can_publish_data=False, can_publish_sources=['camera', 'microphone'],
                                              can_update_own_metadata=False, room_create=False, room_admin=False, room_list=False, room_record=False))
            token = access.to_jwt()
            for recipient in sorted(members - {user['id']}):
                await enqueue(conn, 'notification', {'user_id': recipient, 'event_type': 'booking_call_invite',
                    'booking_id': booking_id, 'session_id': room['id'], 'title': 'Booking call invitation',
                    'body': 'A booking participant is inviting you to a video call.'}, f"video:{room['id']}:invite:{recipient}")
            return {'token': token, 'url': settings.livekit_url, 'sessionId': room['id'], 'bookingId': booking_id,
                    'expiresAt': (datetime.now(UTC) + ttl).isoformat(), 'roomExpiresAt': room['expires_at'].isoformat(),
                    'billing': 'none', 'status': 'open'}
    finally:
        await conn.close()


async def handle_video_webhook(settings: Settings, body: str, authorization: str | None):
    api = require_configuration(settings, cleanup=True)
    if not authorization or len(body.encode('utf-8')) > 262144:
        raise HTTPException(status_code=401, detail='Invalid LiveKit webhook.')
    try:
        event = api.WebhookReceiver(api.TokenVerifier(settings.livekit_api_key, settings.livekit_api_secret)).receive(body, authorization)
    except Exception as error:
        raise HTTPException(status_code=401, detail='Invalid LiveKit webhook.') from error
    if not event.id:
        raise HTTPException(status_code=400, detail='Webhook event ID is required.')
    conn = await connect(settings)
    cleanup = None
    try:
        async with conn.transaction():
            if not await conn.fetchval('INSERT INTO video_webhook_events (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id', event.id):
                return {'received': True}
            room = await conn.fetchrow('SELECT * FROM booking_video_rooms WHERE room_name=$1 FOR UPDATE', event.room.name)
            if not room:
                return {'received': True}
            if event.event == 'participant_joined':
                booking = await conn.fetchrow('SELECT id,client_id,photographer_id,model_id,status,service_type FROM bookings WHERE id=$1', room['booking_id'])
                members = {booking[key] for key in ('client_id', 'photographer_id', 'model_id') if booking[key]} if booking else set()
                authorized = booking and booking['status'] in ('accepted', 'in_progress') and booking['service_type'] in PHYSICAL_SERVICES and event.participant.identity in members
                if authorized:
                    try:
                        await require_access(settings, 'video_call_service', members, connection=conn)
                    except HTTPException:
                        authorized = False
                blocked = authorized and await conn.fetchval('SELECT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id=ANY($1::text[]) AND blocked_id=ANY($1::text[]))', sorted(members))
                if not authorized or blocked or room['status'] != 'open' or room['expires_at'] <= datetime.now(UTC):
                    await conn.execute("UPDATE booking_video_rooms SET status='ending',end_requested_at=coalesce(end_requested_at,now()),updated_at=now() WHERE id=$1", room['id'])
                    await queue_room_end(conn, room['id'], datetime.now(UTC))
                    cleanup = (room['room_name'], sorted(members | {event.participant.identity}))
                else:
                    await conn.execute('UPDATE booking_video_rooms SET connected_at=coalesce(connected_at,now()),updated_at=now() WHERE id=$1', room['id'])
            elif event.event == 'room_finished':
                await conn.execute("UPDATE booking_video_rooms SET status='ended',ended_at=coalesce(ended_at,now()),updated_at=now() WHERE id=$1", room['id'])
        if cleanup:
            try:
                await delete_livekit_room(settings, *cleanup)
            except Exception:
                pass  # The committed outbox job retries remote cleanup.
        return {'received': True}
    finally:
        await conn.close()
