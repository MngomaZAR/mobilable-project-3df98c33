import unittest
from unittest.mock import AsyncMock, patch

from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.account_deletion import DeletionCommand, request_deletion
from app.config import Settings
from app.local_auth import assert_account_access
from app.access_control import authorize_query
from shared.account_cleanup import OPTIONAL_PERSONAL_TABLES, PERSONAL_ROWS, delete_owned_media, financial_hold_reasons, personal_row_tables


class MemoryStorage:
    def __init__(self):
        self.objects = {'avatars': [f'users/owner/{index}.png' for index in range(2005)] + ['users/other/private.png']}
        self.deleted = []

    def list_objects_v2(self, Bucket, Prefix, MaxKeys):
        return {'Contents': [{'Key': key} for key in self.objects.get(Bucket, []) if key.startswith(Prefix)][:MaxKeys]}

    def delete_objects(self, Bucket, Delete):
        for item in Delete['Objects']:
            self.deleted.append(item['Key'])
            self.objects[Bucket].remove(item['Key'])
        return {}


class StorageCleanupTests(unittest.TestCase):
    def test_multiple_batches_never_skip_or_cross_account_namespace(self):
        storage = MemoryStorage()
        self.assertEqual(delete_owned_media('owner', client=storage), 2005)
        self.assertEqual(storage.objects['avatars'], ['users/other/private.png'])
        self.assertEqual(delete_owned_media('owner', client=storage), 0)

    def test_bad_owner_cannot_select_other_namespaces(self):
        for owner in ('', '../other', 'owner/other', 'owner\\other'):
            with self.subTest(owner=owner), self.assertRaises(ValueError):
                delete_owned_media(owner, client=MemoryStorage())

    def test_missing_storage_configuration_does_not_report_success(self):
        with self.assertRaises(RuntimeError):
            delete_owned_media('owner', environ={})

    def test_access_denied_and_partial_delete_errors_remain_retryable(self):
        storage = MemoryStorage()
        with patch.object(storage, 'list_objects_v2', side_effect=ClientError({'Error': {'Code': 'AccessDenied'}}, 'ListObjectsV2')):
            with self.assertRaises(ClientError):
                delete_owned_media('owner', client=storage)
        with patch.object(storage, 'delete_objects', return_value={'Errors': [{'Code': 'AccessDenied'}]}):
            with self.assertRaises(RuntimeError):
                delete_owned_media('owner', client=storage)


class AccountAccessTests(unittest.TestCase):
    def test_processing_and_completed_accounts_cannot_authenticate(self):
        for state in ('processing', 'completed'):
            with self.subTest(state=state), self.assertRaises(HTTPException) as result:
                assert_account_access({'metadata': {'deletion_status': state}})
            self.assertEqual(result.exception.status_code, 401)

    def test_pending_accounts_can_resolve_existing_obligations(self):
        assert_account_access({'metadata': '{"deletion_status":"pending"}'})

    def test_pending_account_cannot_write_generic_content(self):
        with self.assertRaises(HTTPException):
            authorize_query(Settings(_env_file=None), 'posts', {'action': 'insert'}, {'id': 'actor', 'user_metadata': {'deletion_status': 'pending'}})

    def test_legacy_deletion_queue_is_no_longer_publicly_writable(self):
        with self.assertRaises(HTTPException):
            authorize_query(Settings(_env_file=None), 'account_deletion_requests', {'action': 'insert'}, {'id': 'actor'})


class DeletionCommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_optional_legacy_tables_are_not_invented_or_required(self):
        connection = AsyncMock()
        connection.fetch.return_value = [{'table_name': table, 'column_name': owner}
                                         for table, owner in PERSONAL_ROWS.items() if table not in OPTIONAL_PERSONAL_TABLES]
        tables = await personal_row_tables(connection)
        self.assertEqual(set(tables), set(PERSONAL_ROWS) - OPTIONAL_PERSONAL_TABLES)

    async def test_missing_required_owner_column_fails_closed(self):
        connection = AsyncMock()
        connection.fetch.return_value = [{'table_name': table, 'column_name': owner}
                                         for table, owner in PERSONAL_ROWS.items() if table != 'kyc_documents']
        with self.assertRaises(RuntimeError):
            await personal_row_tables(connection)

    async def test_confirmation_required_before_rate_limit_or_database(self):
        with patch('app.account_deletion.connect', new_callable=AsyncMock) as connection:
            with self.assertRaises(HTTPException):
                await request_deletion(Settings(_env_file=None), {'id': 'actor'}, DeletionCommand(confirmation='NO'))
            connection.assert_not_awaited()

    async def test_financial_hold_is_checked_for_actor_and_related_booking(self):
        connection = AsyncMock()
        connection.fetchval.side_effect = [False, False, False, False, True]
        connection.fetch.side_effect = [[], [], [], [{'column_name': field} for field in ('status', 'actor_id', 'user_id', 'booking_id')], []]
        self.assertEqual(await financial_hold_reasons(connection, 'actor'), ['pending_financial_operation'])
        sql = connection.fetchval.await_args_list[-1].args[0]
        self.assertIn('booking_id IN', sql)
        self.assertIn('user_id', sql)


if __name__ == '__main__':
    unittest.main()
