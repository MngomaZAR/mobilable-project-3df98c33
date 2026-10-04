import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.access_control import authorize_query
from app import service_acceptance as acceptance
from app.record_service_acceptance import register
from app.readiness import checked_release_capabilities, account_service_access


REVISION = 'a' * 40


def settings(**overrides):
    values = dict(APP_ENV='production', APP_VERSION=REVISION, DATABASE_URL='postgresql://unused',
                  ADMIN_USER_IDS='reviewer', API_PUBLIC_URL='https://api.unit.invalid', OSRM_BASE_URL='http://routing:5000',
                  LIVEKIT_URL='wss://video.unit.invalid', LIVEKIT_API_KEY='unit', LIVEKIT_API_SECRET='unit-only',
                  LIVEKIT_ENABLED=True, INSTANT_DISPATCH_ENABLED=True, VIDEO_ACCEPTANCE_ID='video-proof',
                  DISPATCH_ACCEPTANCE_ID='dispatch-proof')
    return Settings(_env_file=None, **{**values, **overrides})


def evidence(capability='video_call_service'):
    now = datetime.now(UTC)
    return {'capability': capability, 'revision': REVISION,
            'endpoint': 'wss://video.unit.invalid' if capability == 'video_call_service' else 'https://api.unit.invalid',
            'resource_id': 'completed-resource', 'devices': [
                {'platform': platform, 'physical_device': True, 'device_model': 'test phone', 'os_version': 'test-os',
                 'build_id': platform + '-test-build', 'source_revision': REVISION, 'tested_at': (now - timedelta(hours=1)).isoformat(),
                 'report_reference': 'private-qa-report', 'report_sha256': 'b' * 64,
                 'cases': {case: True for case in acceptance.CASES[capability]}}
                for platform in ('ios', 'android')]}


def record(capability='video_call_service'):
    proof = evidence(capability)
    now = datetime.now(UTC)
    return {'capability': capability, 'revision': REVISION, 'endpoint': proof['endpoint'], 'proof': proof,
            'proof_sha256': acceptance.proof_digest(proof), 'reviewed_by': 'reviewer',
            'accepted_at': now, 'expires_at': now + timedelta(days=30), 'revoked_at': None}


class EvidenceValidationTests(unittest.TestCase):
    def test_account_access_route_requires_auth_and_returns_no_cache_permissions(self):
        from app.main import app, get_settings
        app.dependency_overrides[get_settings] = lambda: settings()
        try:
            with TestClient(app) as client:
                self.assertEqual(client.get('/auth/service-access').status_code, 401)
                response_body = {'user_id': 'client', 'permissions': {'checkout': False}, 'expires_at': datetime.now(UTC).isoformat()}
                with patch('app.main.require_user', AsyncMock(return_value={'id': 'client'})), \
                        patch('app.main.account_service_access', AsyncMock(return_value=response_body)) as grant:
                    response = client.get('/auth/service-access', headers={'Authorization': 'Bearer synthetic-unit-token'})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['cache-control'], 'no-store')
                grant.assert_awaited_once()
                self.assertEqual(grant.await_args.args[1], 'client')
                self.assertNotIn('synthetic-unit-token', response.text)
        finally:
            app.dependency_overrides.pop(get_settings, None)

    def test_complete_matching_reports_are_valid(self):
        for capability in acceptance.CASES:
            self.assertTrue(acceptance.valid_record(settings(), capability, record(capability)))

    def test_bad_provenance_and_revoked_expired_stale_records_fail_closed(self):
        for changes in ({'revision': 'c' * 40}, {'reviewed_by': 'forged-admin'}, {'endpoint': 'wss://other.invalid'},
                        {'revoked_at': datetime.now(UTC)}, {'expires_at': datetime.now(UTC) - timedelta(seconds=1)},
                        {'accepted_at': datetime.now(UTC) + timedelta(days=1)}, {'proof_sha256': '0' * 64}):
            with self.subTest(changes=changes):
                self.assertFalse(acceptance.valid_record(settings(), 'video_call_service', {**record(), **changes}))
        proof = record()
        proof['proof']['devices'][0]['source_revision'] = 'c' * 40
        proof['proof_sha256'] = acceptance.proof_digest(proof['proof'])
        self.assertFalse(acceptance.valid_record(settings(), 'video_call_service', proof))

    def test_emulator_missing_case_failed_case_and_forged_platform_are_rejected(self):
        for mutation in ('emulator', 'missing', 'failed', 'duplicate', 'boolean-string', 'naive-time'):
            proof = evidence()
            device = proof['devices'][0]
            if mutation == 'emulator': device['physical_device'] = False
            elif mutation == 'missing': device['cases'].pop('reconnect')
            elif mutation == 'failed': device['cases']['reconnect'] = False
            elif mutation == 'duplicate': device['platform'] = 'android'
            elif mutation == 'boolean-string': device['cases']['reconnect'] = 'true'
            else: device['tested_at'] = '2026-10-04T10:00:00'
            with self.subTest(mutation=mutation), self.assertRaises(ValidationError):
                acceptance.ServiceEvidence.model_validate(proof)

    def test_configuration_flags_do_not_supply_device_evidence(self):
        self.assertFalse(acceptance.valid_record(settings(), 'video_call_service', None))
        self.assertFalse(acceptance.valid_record(settings(LIVEKIT_ENABLED=False), 'video_call_service', record()))
        self.assertFalse(acceptance.valid_record(settings(INSTANT_DISPATCH_ENABLED=False), 'instant_dispatch_service', record('instant_dispatch_service')))

    def test_report_age_and_changed_digest_are_rejected(self):
        row = record()
        row['proof']['devices'][0]['tested_at'] = (datetime.now(UTC) - timedelta(days=8)).isoformat()
        row['proof_sha256'] = acceptance.proof_digest(row['proof'])
        self.assertFalse(acceptance.valid_record(settings(), 'video_call_service', row))

    def test_canary_is_named_short_lived_and_timezone_aware(self):
        now = datetime.now(UTC)
        good = settings(SERVICE_ACCEPTANCE_USER_IDS=' client , provider ', SERVICE_ACCEPTANCE_EXPIRES_AT=now + timedelta(hours=1))
        self.assertTrue(acceptance.canary_user(good, 'client'))
        self.assertFalse(acceptance.canary_user(good, 'outsider'))
        for expiry in (now, now - timedelta(seconds=1), now + timedelta(hours=25)):
            self.assertFalse(acceptance.canary_active(good.model_copy(update={'service_acceptance_expires_at': expiry}), now))
        with self.assertRaises(ValidationError):
            settings(SERVICE_ACCEPTANCE_EXPIRES_AT='2026-10-04T10:00:00')
        self.assertIsNone(settings(SERVICE_ACCEPTANCE_EXPIRES_AT='').service_acceptance_expires_at)

    def test_acceptance_table_is_not_exposed_even_to_mobile_admin(self):
        for action in ('select', 'insert', 'upsert', 'update', 'delete'):
            with self.subTest(action=action), self.assertRaises(HTTPException) as error:
                authorize_query(settings(), 'service_release_acceptance', {'action': action}, {'id': 'reviewer'})
            self.assertEqual(error.exception.status_code, 403)


class ServiceGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_room_transaction_reuses_its_connection_without_a_second_pool_checkout(self):
        conn = AsyncMock()
        conn.fetchrow.return_value = None
        with patch.object(acceptance, 'connect', AsyncMock()) as database:
            await acceptance.capabilities(settings(), connection=conn)
        database.assert_not_awaited()
        conn.close.assert_not_awaited()

    async def test_account_capabilities_are_short_lived_and_never_grant_unaccepted_payouts(self):
        config = settings(SERVICE_ACCEPTANCE_USER_IDS='client,provider',
                          SERVICE_ACCEPTANCE_EXPIRES_AT=datetime.now(UTC) + timedelta(seconds=30))
        public = {'capabilities': {'payment_checkout_configured': True, 'payment_checkout_enabled': False,
                  'payment_refund_execution': False, 'bank_payout_execution': False,
                  'video_call_service': False, 'instant_dispatch_service': False}}
        with patch('app.readiness.checked_release_capabilities', AsyncMock(return_value=public)):
            allowed = await account_service_access(config, 'client')
            denied = await account_service_access(config, 'outsider')
        self.assertEqual(allowed['permissions'], {'checkout': True, 'payouts': False, 'video': True, 'dispatch': True})
        self.assertFalse(any(denied['permissions'].values()))
        self.assertEqual(allowed['user_id'], 'client')
        self.assertLessEqual(datetime.fromisoformat(allowed['expires_at']), config.service_acceptance_expires_at)
        self.assertNotIn(config.livekit_api_secret, str(allowed))

    async def test_public_gate_needs_real_accepted_record(self):
        with patch.object(acceptance, 'capabilities', AsyncMock(return_value={'video_call_service': False})):
            with self.assertRaises(HTTPException) as error:
                await acceptance.require_access(settings(), 'video_call_service', {'client', 'provider'})
            self.assertEqual(error.exception.status_code, 503)
        with patch.object(acceptance, 'capabilities', AsyncMock(return_value={'video_call_service': True})):
            self.assertTrue(await acceptance.require_access(settings(), 'video_call_service', {'client', 'provider'}))

    async def test_canary_does_not_allow_non_test_participants(self):
        config = settings(SERVICE_ACCEPTANCE_USER_IDS='client,provider', SERVICE_ACCEPTANCE_EXPIRES_AT=datetime.now(UTC) + timedelta(hours=1))
        with patch.object(acceptance, 'capabilities', AsyncMock(return_value={})):
            self.assertFalse(await acceptance.require_access(config, 'video_call_service', {'client', 'provider'}))
            with self.assertRaises(HTTPException):
                await acceptance.require_access(config, 'video_call_service', {'client', 'outsider'})

    async def test_accepted_services_can_clear_their_readiness_checks(self):
        with patch('app.readiness.financial_capabilities', AsyncMock(return_value={})), \
                patch('app.readiness.service_capabilities', AsyncMock(return_value={key: True for key in acceptance.CASES})):
            result = await checked_release_capabilities(settings())
        self.assertTrue(result['capabilities']['video_call_service'])
        self.assertTrue(result['capabilities']['instant_dispatch_service'])
        self.assertFalse(result['required_capabilities_available'])

    async def test_missing_or_unavailable_acceptance_storage_fails_closed(self):
        conn = AsyncMock()
        conn.fetchrow.return_value = None
        with patch.object(acceptance, 'connect', AsyncMock(return_value=conn)):
            self.assertFalse(any((await acceptance.capabilities(settings())).values()))
        conn.close.assert_awaited_once()
        with patch('app.readiness.financial_capabilities', AsyncMock(return_value={})), \
                patch('app.readiness.service_capabilities', AsyncMock(side_effect=RuntimeError('secret'))):
            result = await checked_release_capabilities(settings())
        self.assertIn('video_call_service', result['blockers'])
        self.assertNotIn('secret', str(result))

    async def test_recording_refuses_uncorroborated_evidence(self):
        conn = AsyncMock()
        conn.transaction = Mock(return_value=Transaction())
        conn.fetchrow.return_value = {'email_verified': True, 'metadata': {}}
        conn.fetchval.return_value = False
        with patch('app.record_service_acceptance.connect', AsyncMock(return_value=conn)):
            with self.assertRaises(ValueError):
                await register(settings(), acceptance.ServiceEvidence.model_validate(evidence()), 'acceptance', 'reviewer', apply=True)
        conn.execute.assert_not_awaited()
        conn.close.assert_awaited_once()


class Transaction:
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return False
