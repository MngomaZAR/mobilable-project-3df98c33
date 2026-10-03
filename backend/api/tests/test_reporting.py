import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.config import Settings
from app.reporting import ReportInput, create_report


class ReportingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings = Settings(_env_file=None, DATABASE_URL='postgresql://unused')
        self.conn = AsyncMock()
        self.conn.transaction = lambda: AsyncMock()
        self.conn.fetchval.return_value = True

    async def test_report_and_case_use_server_owner_and_shared_transaction(self):
        with patch('app.reporting.connect', AsyncMock(return_value=self.conn)), patch('app.reporting.rate_limit', AsyncMock()):
            result = await create_report(self.settings, {'id': 'reporter'}, ReportInput(target_type='post', target_id='post', reason='Harassment'))
        self.assertEqual(self.conn.execute.await_count, 2)
        self.assertEqual(self.conn.execute.await_args_list[0].args[2], 'reporter')
        self.assertEqual(self.conn.execute.await_args_list[1].args[-2:], ('4', 6))
        self.assertNotEqual(result['case_id'], result['report_id'])
        self.conn.close.assert_awaited_once()

    async def test_unknown_private_target_never_creates_a_case(self):
        self.conn.fetchval.return_value = False
        with patch('app.reporting.connect', AsyncMock(return_value=self.conn)), patch('app.reporting.rate_limit', AsyncMock()):
            with self.assertRaises(HTTPException) as error:
                await create_report(self.settings, {'id': 'outsider'}, ReportInput(target_type='booking', target_id='private', reason='Unknown'))
        self.assertEqual(error.exception.status_code, 404)
        self.conn.execute.assert_not_awaited()

    async def test_case_failure_propagates_instead_of_false_success(self):
        self.conn.execute.side_effect = [None, RuntimeError('queue unavailable')]
        with patch('app.reporting.connect', AsyncMock(return_value=self.conn)), patch('app.reporting.rate_limit', AsyncMock()):
            with self.assertRaises(RuntimeError):
                await create_report(self.settings, {'id': 'reporter'}, ReportInput(target_type='message', target_id='conversation', reason='Spam'))

    def test_input_rejects_privilege_fields_and_unknown_targets(self):
        for extra in [{'created_by': 'victim'}, {'severity': 0}, {'target_type': 'api_users'}]:
            with self.assertRaises(ValidationError):
                ReportInput.model_validate({'target_type': 'post', 'target_id': 'post', 'reason': 'Spam', **extra})
