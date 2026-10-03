import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from app import database


class DatabaseAccountGuardTests(unittest.IsolatedAsyncioTestCase):
    def connection(self, state=None):
        conn = AsyncMock()
        conn.transaction = MagicMock()
        conn.fetchrow.return_value = {'id': 'owner', 'deletion_status': state}
        return conn

    async def test_read_and_internal_calls_preserve_existing_query_path(self):
        for payload, actor in (({'action': 'select'}, 'owner'), ({'action': 'insert'}, None)):
            with patch.object(database, 'connect', new_callable=AsyncMock) as connect, \
                    patch.object(database, '_execute_table_query', new_callable=AsyncMock) as query:
                query.return_value = {'data': []}
                self.assertEqual(await database.execute_table_query(None, 'posts', payload, actor_id=actor), {'data': []})
                connect.assert_not_awaited()
                query.assert_awaited_once_with(None, 'posts', payload, None)

    async def test_public_write_uses_one_locked_transaction_and_connection(self):
        conn = self.connection()
        payload = {'action': 'insert', 'payload': {'caption': 'test'}}
        scope = ('author_id=$1', ['owner'])
        with patch.object(database, 'connect', AsyncMock(return_value=conn)), \
                patch.object(database, '_execute_table_query', new_callable=AsyncMock) as query:
            await database.execute_table_query(None, 'posts', payload, scope, actor_id='owner')
            self.assertIn('FOR UPDATE', conn.fetchrow.await_args.args[0])
            self.assertEqual(conn.fetchrow.await_args.args[1], 'owner')
            conn.transaction.return_value.__aenter__.assert_awaited_once()
            query.assert_awaited_once_with(None, 'posts', payload, scope, connection=conn)
            conn.close.assert_awaited_once()

    async def test_closing_or_missing_accounts_cannot_write_after_auth_read(self):
        for state in ('pending', 'blocked', 'processing', 'completed', 'missing'):
            conn = self.connection(state)
            if state == 'missing':
                conn.fetchrow.return_value = None
            with self.subTest(state=state), patch.object(database, 'connect', AsyncMock(return_value=conn)), \
                    patch.object(database, '_execute_table_query', new_callable=AsyncMock) as query:
                with self.assertRaises(HTTPException) as result:
                    await database.execute_table_query(None, 'posts', {'action': 'delete'}, actor_id='owner')
                self.assertEqual(result.exception.status_code, 409)
                query.assert_not_awaited()
                conn.close.assert_awaited_once()

    async def test_failed_query_releases_transaction_and_connection(self):
        conn = self.connection()
        with patch.object(database, 'connect', AsyncMock(return_value=conn)), \
                patch.object(database, '_execute_table_query', AsyncMock(side_effect=RuntimeError('fixture failure'))):
            with self.assertRaises(RuntimeError):
                await database.execute_table_query(None, 'posts', {'action': 'update'}, actor_id='owner')
        conn.transaction.return_value.__aexit__.assert_awaited_once()
        conn.close.assert_awaited_once()
