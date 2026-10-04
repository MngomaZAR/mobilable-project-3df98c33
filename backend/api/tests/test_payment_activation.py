import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, Mock, patch
from urllib.parse import urlencode

from fastapi import HTTPException

from app.config import Settings
from app.payments import checkout, confirm_notification, signature
from app.readiness import release_capabilities
from app.financial_operations import FinancialConfig


class PaymentActivationTests(unittest.IsolatedAsyncioTestCase):
    def settings(self, **overrides):
        return Settings(_env_file=None, API_PUBLIC_URL="https://unit.invalid",
                        PAYFAST_MERCHANT_ID="unit-merchant", PAYFAST_MERCHANT_KEY="unit-key",
                        PAYFAST_PASSPHRASE="unit phrase", PAYFAST_SANDBOX=True,
                        PAYFAST_CHECKOUT_ENABLED=False, **overrides)

    async def test_configured_credentials_do_not_create_a_payment_while_paused(self):
        with patch("app.payments.connect", AsyncMock()) as database:
            with self.assertRaises(HTTPException) as error:
                await checkout(self.settings(), "booking", {"id": "client"})
            self.assertEqual(error.exception.status_code, 503)
            database.assert_not_awaited()

    async def test_paused_checkout_does_not_disable_payment_notification_validation(self):
        settings = self.settings()
        fields = {"merchant_id": "unit-merchant", "m_payment_id": "payment",
                  "pf_payment_id": "gateway", "amount_gross": "100.00", "payment_status": "COMPLETE"}
        fields["signature"] = signature(fields, settings.payfast_passphrase)
        gateway = AsyncMock()
        gateway.post.return_value.status_code = 200
        gateway.post.return_value.text = "INVALID"
        with patch("app.payments.httpx.AsyncClient") as client, patch("app.payments.connect", AsyncMock()) as database:
            client.return_value.__aenter__.return_value = gateway
            with self.assertRaises(HTTPException) as error:
                await confirm_notification(settings, urlencode(fields).encode())
            self.assertEqual(error.exception.status_code, 400)
            gateway.post.assert_awaited_once()
            self.assertIn("sandbox.payfast.co.za/eng/query/validate", gateway.post.call_args.args[0])
            database.assert_not_awaited()

    def test_checkout_is_default_off_without_an_environment_override(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(Settings(_env_file=None).payfast_checkout_enabled)

    def test_readiness_distinguishes_configuration_from_activation(self):
        result = release_capabilities(self.settings())
        self.assertTrue(result["capabilities"]["payment_checkout_configured"])
        self.assertIn("payment_checkout_enabled", result["blockers"])
        self.assertFalse(result["required_capabilities_available"])

    def test_plain_http_callbacks_are_not_ready(self):
        settings = self.settings().model_copy(update={"api_public_url": "http://api.unit.invalid"})
        self.assertIn("payment_checkout_configured", release_capabilities(settings)["blockers"])

    async def test_production_flag_alone_cannot_collect_money(self):
        settings = self.settings().model_copy(update={'app_env': 'production', 'payfast_checkout_enabled': True, 'payfast_sandbox': False})
        with patch('app.payments.FinancialConfig.from_env', return_value=FinancialConfig(stitch_mode='live')), \
                patch('app.payments.financial_capabilities', AsyncMock(return_value={'refund_execution': True, 'creator_payout_execution': False})), \
                patch('app.payments.connect', AsyncMock()) as database:
            with self.assertRaises(HTTPException) as error:
                await checkout(settings, 'booking', {'id': 'client'})
            self.assertEqual(error.exception.status_code, 503)
            database.assert_not_awaited()

    async def test_controlled_checkout_rejects_oversized_quote_before_payment_insert(self):
        settings = self.settings().model_copy(update={'app_env': 'production', 'service_acceptance_user_ids': 'client,creator',
            'service_acceptance_expires_at': datetime.now(UTC) + timedelta(hours=1)})
        conn = AsyncMock()
        conn.transaction = Mock(return_value=Transaction())
        conn.fetchrow.return_value = {'client_id': 'client', 'photographer_id': 'creator', 'model_id': None, 'status': 'accepted', 'payment_status': 'unpaid', 'quote_amount': Decimal('51.00')}
        with patch('app.payments.connect', AsyncMock(return_value=conn)):
            with self.assertRaises(HTTPException) as error:
                await checkout(settings, 'booking', {'id': 'client'})
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn('payment limit', error.exception.detail)
        conn.execute.assert_not_awaited()
        self.assertEqual(conn.fetchrow.await_count, 1)


class Transaction:
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return False


if __name__ == "__main__":
    unittest.main()
