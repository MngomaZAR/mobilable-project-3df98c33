import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.access_control import is_admin
from app.config import Settings
from app.local_auth import (
    local_refresh, local_sign_in, local_sign_up, local_update_user,
    user_from_access_token, user_response,
)
from app.main import app, get_settings, normalize_session, normalize_user


def settings(admin_ids='owner'):
    return Settings(_env_file=None, DATABASE_URL='postgresql://unused/papzii_qa_admin',
                    ADMIN_USER_IDS=admin_ids)


def auth_row(user_id='owner', role='client', **metadata):
    return {'id': user_id, 'email': 'qa@example.test', 'password_hash': 'test-only',
            'metadata': {'role': role, **metadata}, 'access_token': 'test-digest'}


def connection(row):
    conn = MagicMock()
    conn.transaction.return_value.__aenter__ = AsyncMock()
    conn.transaction.return_value.__aexit__ = AsyncMock(return_value=False)
    conn.fetchrow = AsyncMock(return_value=row)
    conn.fetchval = AsyncMock(return_value='test-digest')
    conn.execute = AsyncMock()
    conn.close = AsyncMock()
    return conn


class AdminCapabilitySerializationTests(unittest.TestCase):
    def test_allowlist_capability_preserves_business_roles(self):
        config = settings(' other, owner ')
        for role in ('client', 'photographer', 'model'):
            with self.subTest(role=role):
                row = auth_row(role=role)
                user = user_response(row, config)
                self.assertTrue(user['is_admin'])
                self.assertEqual(user['is_admin'], is_admin(config, user))
                self.assertEqual(user['user_metadata']['role'], role)
                self.assertEqual(row['metadata']['role'], role)

    def test_metadata_and_stored_admin_role_cannot_grant_capability(self):
        for role in ('client', 'admin'):
            row = auth_row('attacker', role, is_admin=True, admin=True, roles=['admin'])
            row['is_admin'] = True
            self.assertFalse(user_response(row, settings())['is_admin'])
        self.assertFalse(user_response(auth_row(), settings(''))['is_admin'])

    def test_json_metadata_is_not_a_privilege_source(self):
        row = auth_row('attacker', 'admin', is_admin=True)
        row['metadata'] = json.dumps(row['metadata'])
        self.assertFalse(user_response(row, settings())['is_admin'])

    def test_legacy_auth_normalization_uses_the_same_server_allowlist(self):
        for user_id, expected in (('owner', True), ('attacker', False)):
            raw = {'id': user_id, 'defaultRole': 'model', 'is_admin': True,
                   'metadata': {'is_admin': True, 'role': 'admin'}}
            self.assertEqual(normalize_user(raw, settings())['is_admin'], expected)
            session = normalize_session({'accessToken': 'test-token', 'user': raw}, settings())
            self.assertEqual(session['user']['is_admin'], expected)
            self.assertEqual(session['user']['user_metadata']['role'], 'model')

    def test_auth_me_includes_capability_without_rewriting_roles(self):
        app.dependency_overrides[get_settings] = lambda: settings()
        try:
            with patch('app.local_auth.ensure_local_auth_schema', new_callable=AsyncMock), \
                    patch('app.local_auth.connect', new_callable=AsyncMock) as connect:
                with TestClient(app) as client:
                    for user_id, expected in (('owner', True), ('attacker', False)):
                        connect.return_value = connection(auth_row(user_id, 'client', is_admin=True))
                        response = client.get('/auth/me', headers={'Authorization': 'Bearer test-token'})
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.json()['user']['is_admin'], expected)
                        self.assertEqual(response.json()['roles'], ['client'])
        finally:
            app.dependency_overrides.pop(get_settings, None)


class AdminCapabilityAuthFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_sign_in_and_refresh_recompute_capability_after_allowlist_removal(self):
        config = settings()
        conn = connection(auth_row(role='photographer', is_admin=True))
        with patch('app.local_auth.ensure_local_auth_schema', new_callable=AsyncMock), \
                patch('app.local_auth.rate_limit', new_callable=AsyncMock), \
                patch('app.local_auth.connect', new_callable=AsyncMock, return_value=conn), \
                patch('app.local_auth.verify_password', return_value=True):
            signed_in = await local_sign_in(config, {'email': 'qa@example.test', 'password': 'test'})
            self.assertTrue(signed_in['session']['user']['is_admin'])
            self.assertEqual(signed_in['user']['user_metadata']['role'], 'photographer')
            config.admin_user_ids = ''
            current = await user_from_access_token(config, 'test-token')
            refreshed = await local_refresh(config, 'test-refresh')
            self.assertFalse(current['is_admin'])
            self.assertFalse(refreshed['user']['is_admin'])
            self.assertFalse(refreshed['session']['user']['is_admin'])
            self.assertEqual(refreshed['user']['user_metadata']['role'], 'photographer')

    async def test_profile_auth_update_keeps_server_capability(self):
        conn = connection(auth_row(role='model', full_name='Updated name'))
        with patch('app.local_auth.ensure_local_auth_schema', new_callable=AsyncMock), \
                patch('app.local_auth.connect', new_callable=AsyncMock, return_value=conn):
            result = await local_update_user(settings(), 'test-token', {'data': {'full_name': 'Updated name'}})
        self.assertTrue(result['user']['is_admin'])
        self.assertEqual(result['user']['user_metadata']['role'], 'model')
        updated_metadata = json.loads(conn.fetchrow.call_args.args[3])
        self.assertNotIn('is_admin', updated_metadata)

    async def test_self_assigned_privilege_updates_are_rejected(self):
        for attribute in ('data', 'metadata', 'user_metadata'):
            with self.subTest(attribute=attribute), \
                    patch('app.local_auth.user_from_access_token', new_callable=AsyncMock,
                          return_value=user_response(auth_row('attacker'), settings())), \
                    patch('app.local_auth.connect', new_callable=AsyncMock) as connect:
                with self.assertRaises(HTTPException) as result:
                    await local_update_user(settings(), 'test-token', {attribute: {'is_admin': True}})
                self.assertEqual(result.exception.status_code, 403)
                connect.assert_not_awaited()

    async def test_registration_cannot_choose_an_admin_role(self):
        with patch('app.local_auth.ensure_local_auth_schema', new_callable=AsyncMock), \
                patch('app.local_auth.rate_limit', new_callable=AsyncMock), \
                patch('app.local_auth.connect', new_callable=AsyncMock) as connect:
            with self.assertRaises(HTTPException) as result:
                await local_sign_up(settings(), {'email': 'qa@example.test', 'password': 'valid-test-password',
                                                 'options': {'data': {'role': 'admin', 'is_admin': True}}})
            self.assertEqual(result.exception.status_code, 403)
            connect.assert_not_awaited()

    async def test_registration_discards_self_assigned_capability(self):
        row = auth_row('new-user')
        conn = connection(row)

        async def make_session(config, user):
            return {'access_token': 'test-token', 'user': user_response(user, config)}

        with patch('app.local_auth.ensure_local_auth_schema', new_callable=AsyncMock), \
                patch('app.local_auth.rate_limit', new_callable=AsyncMock), \
                patch('app.local_auth.hash_password', return_value='test-hash'), \
                patch('app.local_auth.connect', new_callable=AsyncMock, return_value=conn), \
                patch('app.local_auth.create_session', side_effect=make_session):
            result = await local_sign_up(settings(), {'email': 'qa@example.test', 'password': 'valid-test-password',
                                                      'options': {'data': {'role': 'client', 'is_admin': True}}})
        self.assertFalse(result['user']['is_admin'])
        stored_metadata = json.loads(conn.fetchrow.call_args.args[4])
        self.assertNotIn('is_admin', stored_metadata)
        self.assertEqual(stored_metadata['role'], 'client')


if __name__ == '__main__':
    unittest.main()
