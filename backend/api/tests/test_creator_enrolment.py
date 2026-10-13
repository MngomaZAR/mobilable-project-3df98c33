import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

import asyncpg
from fastapi import HTTPException

from app.config import Settings
from app.creator_enrolment import enrol_creator
from tests.dispatch_protocol import DatabaseCase


COMMAND = {'role': 'photographer', 'accept_creator_policy': True, 'policy_version': '2026-10-13'}


class EnrolmentValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_untrusted_privileges_and_missing_consent_are_rejected_before_database_access(self):
        settings = Settings(_env_file=None, DATABASE_URL='postgresql://unused')
        for changes in ({'role': 'admin'}, {'user_id': 'victim'}, {'verified': True}, {'accept_creator_policy': False}, {'accept_creator_policy': 1}, {'policy_version': 'old'}):
            with self.subTest(changes=changes), patch('app.creator_enrolment.connect', new_callable=AsyncMock) as connect:
                with self.assertRaises(HTTPException) as error:
                    await enrol_creator(settings, {'id': 'owner'}, {**COMMAND, **changes})
                self.assertEqual(error.exception.status_code, 400)
                connect.assert_not_awaited()


class EnrolmentDatabaseTests(DatabaseCase):
    async def prepare_owner(self):
        conn = await self.connection()
        try:
            await conn.execute("UPDATE profiles SET full_name='Fixture Creator',city='Durban' WHERE id='client'")
        finally:
            await conn.close()

    async def test_concurrent_retries_preserve_accounts_and_cannot_self_approve(self):
        await self.prepare_owner()
        with patch('app.creator_enrolment.connect', side_effect=self.connection):
            results = await asyncio.gather(*(enrol_creator(self.settings, {'id': 'client'}, COMMAND) for _ in range(2)))
        self.assertTrue(all(result['approved'] is False for result in results))
        conn = await self.connection()
        try:
            profile = await conn.fetchrow("SELECT role,verified,kyc_status,availability_status FROM profiles WHERE id='client'")
            self.assertEqual(dict(profile), {'role': 'photographer', 'verified': False, 'kyc_status': 'pending', 'availability_status': 'offline'})
            self.assertEqual(await conn.fetchval("SELECT count(*) FROM photographers WHERE id='client'"), 1)
            self.assertEqual(await conn.fetchval("SELECT count(*) FROM consent_events WHERE user_id='client'"), 1)
            metadata = json.loads(await conn.fetchval("SELECT metadata FROM api_users WHERE id='client'"))
            self.assertEqual(metadata['role'], 'photographer')
            self.assertEqual(await conn.fetchval("SELECT role FROM profiles WHERE id='outsider'"), 'client')
        finally:
            await conn.close()

    async def test_failed_consent_write_rolls_back_role_and_provider_creation(self):
        await self.prepare_owner()
        conn = await self.connection()
        try:
            await conn.execute("ALTER TABLE consent_events ADD CONSTRAINT fixture_block CHECK (consent_type <> 'creator_policy')")
        finally:
            await conn.close()
        with patch('app.creator_enrolment.connect', side_effect=self.connection), self.assertRaises(asyncpg.CheckViolationError):
            await enrol_creator(self.settings, {'id': 'client'}, COMMAND)
        conn = await self.connection()
        try:
            self.assertEqual(await conn.fetchval("SELECT role FROM profiles WHERE id='client'"), 'client')
            self.assertEqual(await conn.fetchval("SELECT count(*) FROM photographers WHERE id='client'"), 0)
        finally:
            await conn.close()
