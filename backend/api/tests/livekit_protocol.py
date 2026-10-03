"""Real LiveKit control-plane checks against a disposable loopback QA server."""
import asyncio
import json
import os
import re
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta
from importlib.metadata import version
from urllib.parse import urlparse

import jwt
from aiohttp import ClientTimeout
from livekit import api


SDK_VERSION = '1.2.1'
SERVER_VERSION = '1.13.7'
IMAGE_DIGEST = 'sha256:6fd3b7088874c4d119160dd688798dfec852bc014786d392caad15f6f63912a3'
TOKEN_LEEWAY_SECONDS = 60


def configuration():
    url = os.environ.get('QA_LIVEKIT_URL', '')
    parsed = urlparse(url)
    run_id = os.environ.get('QA_LIVEKIT_RUN_ID', '')
    key = os.environ.get('QA_LIVEKIT_API_KEY', '')
    secret = os.environ.get('QA_LIVEKIT_API_SECRET', '')
    if (os.environ.get('QA_LIVEKIT_ISOLATED') != '1' or parsed.scheme != 'http' or
            parsed.hostname != '127.0.0.1' or parsed.port is None or
            parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/') or
            not re.fullmatch(r'[a-z0-9]{8,32}', run_id) or not key.startswith(f'qa-{run_id}-') or len(secret) < 32 or
            os.environ.get('QA_LIVEKIT_IMAGE_DIGEST') != IMAGE_DIGEST or
            os.environ.get('QA_LIVEKIT_SERVER_VERSION') != SERVER_VERSION):
        raise RuntimeError('An explicitly isolated, pinned loopback QA fixture is required')
    return url, run_id, key, secret


async def end_room(client, room_name, identities):
    cutoff = int(time.time()) + 1
    for identity in identities:
        try:
            await client.room.remove_participant(api.RoomParticipantIdentity(
                room=room_name, identity=identity, revoke_token_ts=cutoff,
            ))
        except api.TwirpError as error:
            if error.code != 'not_found':
                raise
    try:
        await client.room.delete_room(api.DeleteRoomRequest(room=room_name))
    except api.TwirpError as error:
        if error.code != 'not_found':
            raise


async def run():
    url, run_id, key, secret = configuration()
    prefix = f'papzii-control-qa-{run_id}-'
    room_name = prefix + uuid.uuid4().hex
    other_room = prefix + uuid.uuid4().hex
    identities = [f'qa-client-{uuid.uuid4().hex}', f'qa-provider-{uuid.uuid4().hex}']
    checks = []
    report = {
        'scope': 'Real self-hosted LiveKit control plane; synthetic rooms only',
        'run_id': run_id,
        'started_at': datetime.now(UTC).isoformat(),
        'sdk_version': version('livekit-api'),
        'server_version': SERVER_VERSION,
        'image_digest': IMAGE_DIGEST,
        'token_clock_skew_allowance_seconds': TOKEN_LEEWAY_SECONDS,
        'checks': checks,
        'unproven': ['WebRTC/media', 'native device tracks', 'booking database authorization',
                     'signed webhook delivery', 'cached RTC token revocation', 'production connectivity'],
        'feature_enablement_authorized': False,
    }

    def check(name, passed, **evidence):
        checks.append({'name': name, 'passed': bool(passed), **evidence})
        if not passed:
            raise AssertionError(name)

    async def denied(name, operation):
        try:
            await operation()
        except api.TwirpError as error:
            # The server's auth middleware returns plain-text 401, normalized to "unknown" by the SDK.
            rejected = (error.status == 401 and error.code in {'unknown', 'unauthenticated', 'permission_denied'}) or (error.status == 403 and error.code == 'permission_denied')
            check(name, rejected,
                  code=error.code, http_status=error.status)
        else:
            check(name, False)

    client = api.LiveKitAPI(url, key, secret, timeout=ClientTimeout(total=8), failover=False)
    try:
        check('Official Python SDK version is pinned', report['sdk_version'] == SDK_VERSION)
        for attempt in range(30):
            try:
                listed = await client.room.list_rooms(api.ListRoomsRequest(names=[room_name, other_room]))
                break
            except Exception:
                if attempt == 29:
                    raise
                await asyncio.sleep(0.5)
        check('Fresh isolated room namespace has no existing rooms', not listed.rooms)
        room = await client.room.create_room(api.CreateRoomRequest(
            name=room_name, empty_timeout=180, departure_timeout=5, max_participants=2,
        ))
        check('Room creation uses the requested policy', room.name == room_name and room.max_participants == 2 and room.empty_timeout == 180)
        repeated = await client.room.create_room(api.CreateRoomRequest(name=room_name, empty_timeout=180, max_participants=2))
        check('Repeated room creation reuses the existing room', repeated.sid == room.sid)
        listed = await client.room.list_rooms(api.ListRoomsRequest(names=[room_name]))
        check('Created room is visible through the real room service', len(listed.rooms) == 1 and listed.rooms[0].sid == room.sid)
        participants = await client.room.list_participants(api.ListParticipantsRequest(room=room_name))
        check('Control-plane probe has no joined media participants', not participants.participants)

        tokens = []
        for identity in identities:
            token = api.AccessToken(key, secret).with_identity(identity).with_ttl(timedelta(seconds=120)).with_grants(api.VideoGrants(
                room_join=True, room=room_name, can_publish=True, can_subscribe=True,
                can_publish_data=False, can_publish_sources=['camera', 'microphone'], can_update_own_metadata=False,
                room_create=False, room_admin=False, room_list=False, room_record=False, ingress_admin=False,
            )).to_jwt()
            claims = api.TokenVerifier(key, secret).verify(token)
            payload = jwt.decode(token, secret, algorithms=['HS256'], issuer=key)
            check('Participant token is identity/room scoped and short lived',
                  claims.identity == identity and claims.video.room == room_name and claims.video.room_join and
                  0 < payload['exp'] - payload['nbf'] <= 120 and
                  claims.video.can_publish_sources == ['camera', 'microphone'] and
                  not any([claims.video.room_create, claims.video.room_admin, claims.video.room_list,
                           claims.video.room_record, claims.video.ingress_admin, claims.video.can_publish_data,
                           claims.video.can_update_own_metadata]), ttl_seconds=payload['exp'] - payload['nbf'])
            tokens.append(token)

        for index, token in enumerate(tokens):
            async with api.LiveKitAPI.with_token(token, url, timeout=ClientTimeout(total=8), failover=False) as participant:
                await denied(f'Participant {index + 1} cannot list rooms',
                             lambda: participant.room.list_rooms(api.ListRoomsRequest(names=[room_name])))
                await denied(f'Participant {index + 1} cannot delete its room',
                             lambda: participant.room.delete_room(api.DeleteRoomRequest(room=room_name)))
                await denied(f'Participant {index + 1} cannot grant or remove another identity',
                             lambda: participant.room.remove_participant(api.RoomParticipantIdentity(room=room_name, identity=identities[1 - index])))
        async with api.LiveKitAPI.with_token(tokens[0], url, timeout=ClientTimeout(total=8), failover=False) as participant:
            await denied('Participant cannot create an arbitrary room',
                         lambda: participant.room.create_room(api.CreateRoomRequest(name=other_room)))

        wrong_scope = api.AccessToken(key, secret).with_ttl(timedelta(seconds=120)).with_grants(
            api.VideoGrants(room_admin=True, room=other_room),
        ).to_jwt()
        async with api.LiveKitAPI.with_token(wrong_scope, url, timeout=ClientTimeout(total=8), failover=False) as scoped:
            await denied('Room-scoped admin grant cannot operate on a different room',
                         lambda: scoped.room.list_participants(api.ListParticipantsRequest(room=room_name)))
        invalid_signature = api.AccessToken(key, secret + '-invalid').with_grants(api.VideoGrants(room_list=True)).to_jwt()
        async with api.LiveKitAPI.with_token(invalid_signature, url, timeout=ClientTimeout(total=8), failover=False) as invalid:
            await denied('Wrong token signature is rejected by the server',
                         lambda: invalid.room.list_rooms(api.ListRoomsRequest(names=[room_name])))

        short_token = api.AccessToken(key, secret).with_ttl(timedelta(seconds=5)).with_grants(api.VideoGrants(room_list=True)).to_jwt()
        payload = jwt.decode(short_token, secret, algorithms=['HS256'], issuer=key)
        async with api.LiveKitAPI.with_token(short_token, url, timeout=ClientTimeout(total=8), failover=False) as expiring:
            listed = await expiring.room.list_rooms(api.ListRoomsRequest(names=[room_name]))
            check('A valid short-lived control token is accepted', len(listed.rooms) == 1, ttl_seconds=payload['exp'] - payload['nbf'])
            print('Waiting for control token expiry plus server clock-skew allowance; no RTC connection is attempted.', flush=True)
            await asyncio.sleep(max(0, payload['exp'] + TOKEN_LEEWAY_SECONDS + 2 - time.time()))
            await denied('The same control token is rejected after expiry plus clock-skew allowance',
                         lambda: expiring.room.list_rooms(api.ListRoomsRequest(names=[room_name])))

        await end_room(client, room_name, identities)
        listed = await client.room.list_rooms(api.ListRoomsRequest(names=[room_name]))
        check('Explicit room end removes the room from the real server', not listed.rooms)
        await end_room(client, room_name, identities)
        listed = await client.room.list_rooms(api.ListRoomsRequest(names=[room_name, other_room]))
        check('Repeated end is idempotent and no arbitrary room was created', not listed.rooms)
    except Exception as error:
        report['error_type'] = type(error).__name__
    finally:
        cleanup_ok = True
        for owned_room in (room_name, other_room):
            try:
                await end_room(client, owned_room, [])
            except Exception:
                cleanup_ok = False
        report['room_cleanup_succeeded'] = cleanup_ok
        await client.aclose()
        report['passed'] = bool(checks) and all(item['passed'] for item in checks) and 'error_type' not in report and cleanup_ok
        report['finished_at'] = datetime.now(UTC).isoformat()
        print(json.dumps(report), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(asyncio.run(run()))
    except Exception as error:
        print(json.dumps({'passed': False, 'scope': 'isolated LiveKit control plane', 'error_type': type(error).__name__}), flush=True)
        sys.exit(1)
