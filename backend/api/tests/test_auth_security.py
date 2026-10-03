import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from cryptography.fernet import Fernet, InvalidToken

from app.auth_security import recovery_configured, token_digest
from app.config import Settings
from app.main import authentication_abuse_guard
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from shared.recovery_mail import encrypt_reset_token, decrypt_reset_token, send_reset_email


class AuthSecurityTests(unittest.TestCase):
    def test_token_fingerprints_are_stable_and_irreversible(self):
        value = token_digest('raw-session-secret')
        self.assertEqual(len(value), 64)
        self.assertNotIn('raw-session-secret', value)
        self.assertEqual(value, token_digest('raw-session-secret'))
        self.assertNotEqual(value, token_digest('other-session'))

    def test_reset_job_is_encrypted_and_wrong_key_fails(self):
        key = Fernet.generate_key().decode()
        encrypted = encrypt_reset_token(key, 'private-reset-code')
        self.assertNotIn('private-reset-code', encrypted)
        self.assertEqual(decrypt_reset_token(key, encrypted), 'private-reset-code')
        with self.assertRaises(InvalidToken):
            decrypt_reset_token(Fernet.generate_key().decode(), encrypted)

    def test_recovery_configuration_fails_closed(self):
        values = dict(SMTP_HOST='smtp.test', SMTP_USER='test', SMTP_PASSWORD='test', SMTP_FROM='support@example.test')
        self.assertFalse(recovery_configured(Settings(_env_file=None, **values)))
        self.assertFalse(recovery_configured(Settings(_env_file=None, RECOVERY_ENCRYPTION_KEY='invalid', **values)))
        self.assertTrue(recovery_configured(Settings(_env_file=None, RECOVERY_ENCRYPTION_KEY=Fernet.generate_key().decode(), **values)))

    def test_smtp_uses_tls_without_debug_logging(self):
        config = dict(SMTP_HOST='smtp.test', SMTP_USER='user', SMTP_PASSWORD='secret', SMTP_FROM='support@example.test')
        with patch('shared.recovery_mail.smtplib.SMTP') as factory:
            smtp = MagicMock()
            factory.return_value.__enter__.return_value = smtp
            send_reset_email(config, 'recipient@example.test', 'reset-code')
            smtp.starttls.assert_called_once()
            smtp.login.assert_called_once_with('user', 'secret')
            smtp.send_message.assert_called_once()
            smtp.set_debuglevel.assert_not_called()


class AuthenticationAbuseGuardTests(unittest.IsolatedAsyncioTestCase):
    def request(self, host=b'example.invalid/bypass'):
        return Request({'type': 'http', 'method': 'POST', 'path': '/auth/sign-in',
                        'query_string': b'', 'scheme': 'https', 'server': ('example.invalid', 443),
                        'client': ('203.0.113.4', 50000),
                        'headers': [(b'host', host), (b'x-forwarded-for', b'198.51.100.9')]})

    async def test_rate_limit_uses_asgi_path_not_host_derived_url(self):
        settings = Settings(_env_file=None, DATABASE_URL='postgresql://qa.invalid/papzii_qa_guard')
        response = JSONResponse({'ok': True})
        next_handler = AsyncMock(return_value=response)
        with patch('app.main.get_settings', return_value=settings), patch('app.main.rate_limit', new_callable=AsyncMock) as limit:
            self.assertIs(await authentication_abuse_guard(self.request(), next_handler), response)
            limit.assert_awaited_once_with(settings, 'auth-ip:/auth/sign-in:203.0.113.4', 120)
        next_handler.assert_awaited_once()

    async def test_rate_limit_stops_auth_request_with_retry_after(self):
        settings = Settings(_env_file=None, DATABASE_URL='postgresql://qa.invalid/papzii_qa_guard')
        next_handler = AsyncMock()
        error = HTTPException(429, 'Too many attempts', headers={'Retry-After': '60'})
        with patch('app.main.get_settings', return_value=settings), patch('app.main.rate_limit', new_callable=AsyncMock, side_effect=error):
            result = await authentication_abuse_guard(self.request(), next_handler)
        self.assertEqual(result.status_code, 429)
        self.assertEqual(result.headers['retry-after'], '60')
        next_handler.assert_not_awaited()
