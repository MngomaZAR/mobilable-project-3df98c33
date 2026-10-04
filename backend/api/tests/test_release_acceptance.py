import unittest
from unittest.mock import AsyncMock, patch

from app.config import Settings
from app.financial_operations import FinancialConfig
from app.readiness import checked_release_capabilities


class ReleaseAcceptanceTests(unittest.IsolatedAsyncioTestCase):
    def settings(self, sandbox=False):
        return Settings(_env_file=None, DATABASE_URL='postgresql://unused', PAYFAST_SANDBOX=sandbox)

    async def test_accepted_live_financial_capabilities_are_not_hardcoded_false(self):
        with patch('app.readiness.FinancialConfig.from_env', return_value=FinancialConfig(stitch_mode='live')), \
                patch('app.readiness.financial_capabilities', AsyncMock(return_value={
                    'refund_execution': True, 'creator_payout_execution': True})) as accepted:
            result = await checked_release_capabilities(self.settings())
        accepted.assert_awaited_once()
        self.assertTrue(result['capabilities']['payment_refund_execution'])
        self.assertTrue(result['capabilities']['bank_payout_execution'])
        self.assertFalse(result['required_capabilities_available'])

    async def test_sandbox_acceptance_is_not_production_financial_acceptance(self):
        with patch('app.readiness.FinancialConfig.from_env', return_value=FinancialConfig(stitch_mode='sandbox')), \
                patch('app.readiness.financial_capabilities', AsyncMock(return_value={
                    'refund_execution': True, 'creator_payout_execution': True})):
            result = await checked_release_capabilities(self.settings(sandbox=True))
        self.assertIn('payment_refund_execution', result['blockers'])
        self.assertIn('bank_payout_execution', result['blockers'])

    async def test_unavailable_acceptance_database_fails_closed_without_private_errors(self):
        with patch('app.readiness.financial_capabilities', AsyncMock(side_effect=RuntimeError('private database credentials'))):
            result = await checked_release_capabilities(self.settings())
        self.assertIn('payment_refund_execution', result['blockers'])
        self.assertIn('bank_payout_execution', result['blockers'])
        self.assertNotIn('private database credentials', str(result))

    async def test_legacy_non_postgres_configuration_cannot_infer_acceptance(self):
        with patch('app.readiness.financial_capabilities', AsyncMock()) as accepted:
            result = await checked_release_capabilities(Settings(_env_file=None, DATABASE_URL='', NEON_DATABASE_URL=''))
        accepted.assert_not_awaited()
        self.assertFalse(result['capabilities']['bank_payout_execution'])
