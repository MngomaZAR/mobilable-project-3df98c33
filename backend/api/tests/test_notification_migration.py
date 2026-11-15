import json
from pathlib import Path

from tests.dispatch_protocol import DatabaseCase


class NotificationDestinationMigrationTests(DatabaseCase):
    async def test_legacy_destinations_are_backfilled_without_changing_read_state(self):
        conn = await self.connection()
        try:
            fixtures = [
                ('legacy-booking', {'booking_id': 'booking-1'}, 'booking_requested', None, None),
                ('legacy-chat', {'conversation_id': 'chat-1', 'booking_id': 'booking-1'}, 'message_received', '', None),
                ('legacy-payment', {'booking_id': 'booking-1'}, 'payment_received', 'booking', None),
                ('existing-route', {'booking_id': 'booking-1'}, 'booking_requested', 'booking', 'booking'),
                ('unknown-route', {}, 'social_update', None, None),
                ('custom-route', {'booking_id': 'booking-1'}, 'support_update', 'support', None),
            ]
            for identity, payload, event, action, category in fixtures:
                await conn.execute('''INSERT INTO notification_events
                    (id,user_id,event_type,status,action_payload,action_type,category)
                    VALUES ($1,'fixture-owner',$2,'read',$3::jsonb,$4,$5)''',
                    identity, event, json.dumps(payload), action, category)
            migration = Path(__file__).resolve().parents[1] / 'migrations' / '202610130014_notification_destinations.sql'
            await conn.execute(migration.read_text())
            rows = {row['id']: dict(row) for row in await conn.fetch(
                'SELECT id,status,action_type,category FROM notification_events')}
            self.assertEqual((rows['legacy-booking']['action_type'], rows['legacy-booking']['category']), ('booking', 'booking'))
            self.assertEqual((rows['legacy-chat']['action_type'], rows['legacy-chat']['category']), ('chat', 'message'))
            self.assertEqual((rows['legacy-payment']['action_type'], rows['legacy-payment']['category']), ('booking', 'earnings'))
            self.assertIsNone(rows['unknown-route']['action_type'])
            self.assertEqual(rows['custom-route']['action_type'], 'support')
            self.assertTrue(all(row['status'] == 'read' for row in rows.values()))
            await conn.execute(migration.read_text())
            self.assertEqual(await conn.fetchval('SELECT count(*) FROM notification_events'), len(fixtures))
        finally:
            await conn.close()
