import os
from datetime import UTC, datetime


async def process_video_room_end(conn, payload):
    from livekit import api
    from aiohttp import ClientTimeout

    if not os.getenv('LIVEKIT_URL') or not os.getenv('LIVEKIT_API_KEY') or not os.getenv('LIVEKIT_API_SECRET'):
        raise RuntimeError('LiveKitCleanupUnavailable')
    async with conn.transaction():
        row = await conn.fetchrow('SELECT * FROM booking_video_rooms WHERE id=$1 FOR UPDATE', payload['session_id'])
        if not row:
            return
        booking = await conn.fetchrow('SELECT client_id,photographer_id,model_id FROM bookings WHERE id=$1', row['booking_id'])
        members = {booking[key] for key in ('client_id', 'photographer_id', 'model_id') if booking[key]} if booking else set()
        await conn.execute("UPDATE booking_video_rooms SET status='ending',end_requested_at=coalesce(end_requested_at,now()),updated_at=now() WHERE id=$1", row['id'])
    async with api.LiveKitAPI(os.getenv('LIVEKIT_API_URL') or os.environ['LIVEKIT_URL'], api_key=os.environ['LIVEKIT_API_KEY'],
                              api_secret=os.environ['LIVEKIT_API_SECRET'], timeout=ClientTimeout(total=8)) as client:
        cutoff = int(datetime.now(UTC).timestamp()) + 1
        for identity in sorted(members):
            try:
                await client.room.remove_participant(api.RoomParticipantIdentity(room=row['room_name'], identity=identity, revoke_token_ts=cutoff))
            except api.TwirpError as error:
                if error.code != 'not_found':
                    raise
        try:
            await client.room.delete_room(api.DeleteRoomRequest(room=row['room_name']))
        except api.TwirpError as error:
            if error.code != 'not_found':
                raise
    await conn.execute("UPDATE booking_video_rooms SET status='ended',ended_at=coalesce(ended_at,now()),updated_at=now() WHERE id=$1", row['id'])
