import base64
import hashlib
import json
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from livekit import api

from app.video_calls import handle_video_call, handle_video_webhook, require_configuration


class Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class Connection:
    def __init__(self):
        self.booking = {'id': 'booking-1', 'client_id': 'client-1', 'photographer_id': 'provider-1', 'model_id': None, 'status': 'accepted', 'service_type': 'photography'}
        self.room = None
        self.blocked = False
        self.sql = []
        self.events = set()
        self.closed = False

    def transaction(self):
        return Transaction()

    async def fetchrow(self, sql, *args):
        self.sql.append((sql, args))
        if 'FROM bookings' in sql:
            return self.booking
        if 'SELECT * FROM booking_video_rooms' in sql:
            return self.room
        if 'INSERT INTO booking_video_rooms' in sql:
            self.room = {'id': args[0], 'booking_id': args[1], 'room_name': args[2], 'expires_at': args[3], 'status': 'open'}
            return self.room
        raise AssertionError(sql)

    async def fetchval(self, sql, *args):
        self.sql.append((sql, args))
        if 'user_blocks' in sql:
            return self.blocked
        if 'video_webhook_events' in sql:
            if args[0] in self.events:
                return None
            self.events.add(args[0])
            return args[0]
        raise AssertionError(sql)

    async def execute(self, sql, *args):
        self.sql.append((sql, args))
        if "SET status='ending'" in sql:
            self.room['status'] = 'ending'
        elif "SET status='ended'" in sql:
            self.room['status'] = 'ended'

    async def close(self):
        self.closed = True


class VideoCallTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings = SimpleNamespace(livekit_enabled=True, livekit_url='wss://livekit.example.invalid', livekit_api_url='',
                                        livekit_api_key='qa-key', livekit_api_secret='qa-secret-not-real-at-least-32-characters', app_env='production')
        self.conn = Connection()
        self.user = {'id': 'client-1'}
        self.client = AsyncMock()
        self.client.__aenter__.return_value = self.client
        self.connect_patch = patch('app.video_calls.connect', AsyncMock(return_value=self.conn))
        self.client_patch = patch('app.video_calls._client', return_value=self.client)
        self.access_patch = patch('app.video_calls.require_access', AsyncMock(return_value=True))
        self.connect_patch.start()
        self.client_patch.start()
        self.access_patch.start()
        self.addCleanup(self.connect_patch.stop)
        self.addCleanup(self.client_patch.stop)
        self.addCleanup(self.access_patch.stop)

    async def call(self, **payload):
        return await handle_video_call(self.settings, self.user, {'booking_id': 'booking-1', **payload})

    async def test_real_sdk_token_has_only_booking_media_grants_and_short_ttl(self):
        response = await self.call()
        claims = api.TokenVerifier(self.settings.livekit_api_key, self.settings.livekit_api_secret).verify(response['token'])
        self.assertEqual(claims.identity, self.user['id'])
        self.assertEqual(claims.video.room, self.conn.room['room_name'])
        self.assertTrue(claims.video.room_join)
        self.assertFalse(claims.video.room_admin)
        self.assertFalse(claims.video.room_create)
        self.assertFalse(claims.video.can_publish_data)
        self.assertEqual(claims.video.can_publish_sources, ['camera', 'microphone'])
        self.assertEqual(response['billing'], 'none')
        self.assertLessEqual((datetime.fromisoformat(response['expiresAt']) - datetime.now(UTC)).total_seconds(), 121)
        self.assertTrue(self.conn.closed)

    async def test_creator_role_room_and_identity_injection_is_rejected(self):
        for field in ('creator_id', 'creatorId', 'role', 'room', 'grants', 'identity'):
            with self.assertRaises(HTTPException) as error:
                await self.call(**{field: 'attacker'})
            self.assertEqual(error.exception.status_code, 400)
        self.client.room.create_room.assert_not_called()

    async def test_nonparticipant_admin_cannot_join_or_end(self):
        self.user = {'id': 'stranger', 'role': 'admin'}
        for action in ('join', 'end'):
            with self.assertRaises(HTTPException) as error:
                await self.call(action=action, session_id='other')
            self.assertEqual(error.exception.status_code, 403)

    async def test_pending_cancelled_and_digital_bookings_do_not_issue_tokens(self):
        for state in ('pending', 'cancelled', 'completed'):
            self.conn.booking['status'] = state
            with self.assertRaises(HTTPException):
                await self.call()
        self.conn.booking.update(status='accepted', service_type='video_call')
        with self.assertRaises(HTTPException) as error:
            await self.call()
        self.assertIn('compliant billing', error.exception.detail)
        self.client.room.create_room.assert_not_called()

    async def test_blocked_booking_call_cannot_join(self):
        self.conn.blocked = True
        with self.assertRaises(HTTPException) as error:
            await self.call()
        self.assertEqual(error.exception.status_code, 403)

    async def test_unaccepted_service_cannot_issue_a_new_room(self):
        self.access_patch.stop()
        with patch('app.video_calls.require_access', AsyncMock(side_effect=HTTPException(503, 'pending acceptance'))):
            with self.assertRaises(HTTPException) as error:
                await self.call()
        self.assertEqual(error.exception.status_code, 503)
        self.assertIsNone(self.conn.room)
        self.client.room.create_room.assert_not_called()

    async def test_pausing_service_does_not_prevent_participant_room_cleanup(self):
        response = await self.call()
        self.settings.livekit_enabled = False
        self.access_patch.stop()
        with patch('app.video_calls.require_access', AsyncMock(side_effect=HTTPException(503, 'paused'))):
            ended = await self.call(action='end', session_id=response['sessionId'])
        self.assertEqual(ended['status'], 'ended')

    async def test_retries_reuse_the_persisted_room(self):
        first = await self.call()
        second = await self.call()
        self.assertEqual(first['sessionId'], second['sessionId'])
        self.assertEqual(sum('INSERT INTO booking_video_rooms' in sql for sql, _ in self.conn.sql), 1)
        self.assertTrue(any('livekit_room_end' in sql for sql, _ in self.conn.sql))

    async def test_failed_room_creation_preserves_scheduled_cleanup(self):
        self.client.room.create_room.side_effect = RuntimeError('not exposed')
        with self.assertRaises(HTTPException) as error:
            await self.call()
        self.assertEqual(error.exception.status_code, 503)
        self.assertIsNotNone(self.conn.room)
        self.assertTrue(any('livekit_room_end' in sql for sql, _ in self.conn.sql))

    async def test_ended_or_expired_room_cannot_issue_new_token(self):
        await self.call()
        for field, value in [('status', 'ended'), ('expires_at', datetime.now(UTC) - timedelta(seconds=1))]:
            self.conn.room.update(status='open', expires_at=datetime.now(UTC) + timedelta(hours=1))
            self.conn.room[field] = value
            with self.assertRaises(HTTPException) as error:
                await self.call()
            self.assertEqual(error.exception.status_code, 409)

    async def test_end_is_authorized_idempotent_and_has_no_earnings_effect(self):
        session = await self.call()
        with patch('app.video_calls.delete_livekit_room', AsyncMock()) as delete:
            result = await self.call(action='end', session_id=session['sessionId'])
            again = await self.call(action='end', session_id=session['sessionId'])
        self.assertEqual(result['status'], 'ended')
        self.assertEqual(again, result)
        delete.assert_awaited_once()
        self.assertFalse(any('earnings' in sql or 'video_call_sessions' in sql for sql, _ in self.conn.sql))

    async def test_end_remote_failure_is_durable_and_not_reported_as_complete(self):
        session = await self.call()
        with patch('app.video_calls.delete_livekit_room', AsyncMock(side_effect=RuntimeError('private'))):
            result = await self.call(action='end', session_id=session['sessionId'])
        self.assertEqual(result['status'], 'ending')
        self.assertTrue(result['cleanup_pending'])
        self.assertEqual(self.conn.room['status'], 'ending')

    async def test_other_session_id_cannot_be_ended(self):
        await self.call()
        with self.assertRaises(HTTPException) as error:
            await self.call(action='end', session_id='other')
        self.assertEqual(error.exception.status_code, 404)

    async def test_webhook_signature_body_hash_and_duplicate_events(self):
        await self.call()
        body = json.dumps({'id': 'event-1', 'event': 'participant_joined', 'room': {'name': self.conn.room['room_name']}, 'participant': {'identity': 'client-1'}})
        digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
        token = api.AccessToken(self.settings.livekit_api_key, self.settings.livekit_api_secret).with_sha256(digest).to_jwt()
        await handle_video_webhook(self.settings, body, token)
        await handle_video_webhook(self.settings, body, token)
        self.assertEqual(sum('SET connected_at' in sql for sql, _ in self.conn.sql), 1)
        with self.assertRaises(HTTPException) as error:
            await handle_video_webhook(self.settings, body + ' ', token)
        self.assertEqual(error.exception.status_code, 401)

    async def test_signed_join_for_closed_cancelled_blocked_or_unknown_identity_queues_cleanup(self):
        await self.call()
        for index, scenario in enumerate(('ended', 'cancelled', 'blocked', 'stranger')):
            self.conn.room['status'] = 'ended' if scenario == 'ended' else 'open'
            self.conn.booking['status'] = 'cancelled' if scenario == 'cancelled' else 'accepted'
            self.conn.blocked = scenario == 'blocked'
            body = json.dumps({'id': f'event-{index}', 'event': 'participant_joined', 'room': {'name': self.conn.room['room_name']},
                               'participant': {'identity': 'stranger' if scenario == 'stranger' else 'client-1'}})
            digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
            token = api.AccessToken(self.settings.livekit_api_key, self.settings.livekit_api_secret).with_sha256(digest).to_jwt()
            with patch('app.video_calls.delete_livekit_room', AsyncMock()) as delete:
                await handle_video_webhook(self.settings, body, token)
            self.assertEqual(self.conn.room['status'], 'ending')
            delete.assert_awaited_once()
        self.assertFalse(any('SET connected_at' in sql for sql, _ in self.conn.sql))

    async def test_room_cleanup_removes_current_identities_with_explicit_cutoff(self):
        from app.video_calls import delete_livekit_room
        await delete_livekit_room(self.settings, 'opaque-room', ['client-1', 'provider-1'])
        requests = [call.args[0] for call in self.client.room.remove_participant.call_args_list]
        self.assertEqual([request.identity for request in requests], ['client-1', 'provider-1'])
        self.assertTrue(all(request.revoke_token_ts >= int(datetime.now(UTC).timestamp()) for request in requests))
        self.client.room.delete_room.assert_awaited_once()

    def test_configuration_is_opt_in_and_insecure_url_is_only_loopback_qa(self):
        self.settings.livekit_enabled = False
        with self.assertRaises(HTTPException):
            require_configuration(self.settings)
        self.settings.livekit_enabled = True
        self.settings.livekit_url = 'ws://127.0.0.1:7880'
        with self.assertRaises(HTTPException):
            require_configuration(self.settings)
        self.settings.app_env = 'test'
        require_configuration(self.settings)
        self.settings.livekit_url = 'ws://public.example.invalid'
        with self.assertRaises(HTTPException):
            require_configuration(self.settings)
