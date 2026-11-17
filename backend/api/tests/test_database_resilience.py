import unittest
from unittest.mock import AsyncMock, patch

import asyncpg
from app.config import Settings
from app.database import schema_contract_status
from app.local_auth import _account_service_error


class DatabaseResilienceTests(unittest.IsolatedAsyncioTestCase):
    def test_schema_errors_are_reported_as_service_unavailable(self):
        error = _account_service_error(asyncpg.exceptions.UndefinedTableError('missing table'))
        self.assertEqual(error.status_code, 503)
        self.assertIn('migrations', str(error.detail))

    def test_connection_errors_are_reported_as_service_unavailable(self):
        error = _account_service_error(asyncpg.exceptions.ConnectionDoesNotExistError('connection lost'))
        self.assertEqual(error.status_code, 503)
        self.assertIn('temporarily unavailable', str(error.detail))

    async def test_contract_check_returns_structured_database_unavailable(self):
        config = Settings(_env_file=None, DATABASE_URL='postgresql://unused/papzii')
        with patch('app.database.connect', new_callable=AsyncMock,
                   side_effect=asyncpg.exceptions.ConnectionDoesNotExistError('connection lost')):
            result = await schema_contract_status(config, {'profiles': ['id']})
        self.assertEqual(result['provider'], 'postgres')
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'database_unavailable')


if __name__ == '__main__':
    unittest.main()
