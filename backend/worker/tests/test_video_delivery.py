import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from livekit import api
from backend.worker.app.video_delivery import process_video_room_end


class Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class VideoDeliveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.conn = MagicMock()
        self.conn.transaction.return_value = Transaction()
        self.room = {'id': 'session-1', 'booking_id': 'booking-1', 'room_name': 'persisted-opaque-room'}
        self.booking = {'client_id': 'client-1', 'photographer_id': 'provider-1', 'model_id': None}
        self.conn.fetchrow = AsyncMock(side_effect=[self.room, self.booking])
        self.conn.execute = AsyncMock()
        self.client = AsyncMock()
        self.client.__aenter__.return_value = self.client
        self.env = patch.dict('os.environ', {'LIVEKIT_URL': 'ws://127.0.0.1:7880', 'LIVEKIT_API_KEY': 'unit-key', 'LIVEKIT_API_SECRET': 'unit-secret-never-used-with-network'})
        self.sdk = patch('livekit.api.LiveKitAPI', return_value=self.client)
        self.env.start()
        self.sdk.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.sdk.stop)

    async def test_cleanup_uses_only_persisted_room_and_revokes_current_members(self):
        await process_video_room_end(self.conn, {'session_id': 'session-1', 'room': 'forged-room'})
        request = self.client.room.delete_room.call_args.args[0]
        self.assertEqual(request.room, self.room['room_name'])
        removals = [call.args[0] for call in self.client.room.remove_participant.call_args_list]
        self.assertEqual([item.identity for item in removals], ['client-1', 'provider-1'])
        self.assertTrue(all(item.revoke_token_ts >= int(datetime.now(UTC).timestamp()) for item in removals))
        self.assertIn("SET status='ending'", self.conn.execute.call_args_list[0].args[0])
        self.assertIn("SET status='ended'", self.conn.execute.call_args_list[-1].args[0])

    async def test_deleted_session_is_idempotent(self):
        self.conn.fetchrow.side_effect = None
        self.conn.fetchrow.return_value = None
        await process_video_room_end(self.conn, {'session_id': 'deleted-session'})
        self.client.room.delete_room.assert_not_called()

    async def test_remote_failure_retains_ending_state_for_outbox_retry(self):
        self.client.room.delete_room.side_effect = TimeoutError('not persisted')
        with self.assertRaises(TimeoutError):
            await process_video_room_end(self.conn, {'session_id': 'session-1'})
        self.assertEqual(self.conn.execute.call_count, 1)
        self.assertIn("SET status='ending'", self.conn.execute.call_args.args[0])

    async def test_already_removed_participants_and_room_are_successful_cleanup(self):
        self.client.room.remove_participant.side_effect = api.TwirpError('not_found', 'absent', status=404)
        self.client.room.delete_room.side_effect = api.TwirpError('not_found', 'absent', status=404)
        await process_video_room_end(self.conn, {'session_id': 'session-1'})
        self.assertIn("SET status='ended'", self.conn.execute.call_args.args[0])

    async def test_no_configuration_cannot_report_remote_cleanup_done(self):
        with patch.dict('os.environ', {'LIVEKIT_API_SECRET': ''}):
            with self.assertRaises(RuntimeError):
                await process_video_room_end(self.conn, {'session_id': 'session-1'})
        self.conn.execute.assert_not_called()
