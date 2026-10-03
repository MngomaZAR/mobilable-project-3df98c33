import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.worker.app.main import extra_job_handlers, keep_job_lease, process_notification, process_one, run


class Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class Acquire(Transaction):
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn


def connection(job=None):
    conn = MagicMock()
    conn.transaction.return_value = Transaction()
    conn.execute = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=job)
    return conn


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    def job(self, kind='account_deletion', attempts=1):
        return {'id': 'job-1', 'kind': kind, 'payload': {'user_id': 'user-1'}, 'attempts': attempts, 'max_attempts': 8}

    async def test_notification_event_and_device_deliveries_are_idempotent(self):
        conn = connection()
        job = self.job('notification')
        job['payload'].update(event_type='booking', title='Booking', body='Ready')
        await process_notification(conn, job)
        await process_notification(conn, job)
        first, second, repeated, _ = conn.execute.call_args_list
        self.assertEqual(first.args[1], repeated.args[1])
        self.assertIn('ON CONFLICT (id) DO NOTHING', first.args[0])
        self.assertIn('ON CONFLICT (job_id,token_id) DO NOTHING', second.args[0])

    async def test_deletion_financial_hold_defers_24h_without_failure_attempt(self):
        conn = connection(self.job())
        callback = AsyncMock(return_value=False)
        await process_one(conn, {'account_deletion': callback})
        callback.assert_awaited_once_with(conn, {'user_id': 'user-1'})
        sql = conn.execute.call_args.args[0]
        self.assertIn("interval '24 hours'", sql)
        self.assertIn('GREATEST(attempts-1,0)', sql)
        self.assertNotIn("status='done'", sql)

    async def test_completed_deletion_is_done_and_unknown_result_is_not(self):
        conn = connection(self.job())
        await process_one(conn, {'account_deletion': AsyncMock(return_value=True)})
        self.assertIn("status='done'", conn.execute.call_args.args[0])
        conn = connection(self.job())
        await process_one(conn, {'account_deletion': AsyncMock(return_value=None)})
        self.assertEqual(conn.execute.call_args.args[2], 'pending')

    async def test_failure_retry_is_fenced_and_does_not_store_secret_error_message(self):
        conn = connection(self.job())
        await process_one(conn, {'account_deletion': AsyncMock(side_effect=RuntimeError('secret-value'))})
        sql, *args = conn.execute.call_args.args
        self.assertIn('attempts=$5', sql)
        self.assertIn('RuntimeError', args)
        self.assertNotIn('secret-value', str(args))

    async def test_exhausted_job_fails_without_invoking_callback(self):
        conn = connection(self.job(attempts=9))
        callback = AsyncMock()
        await process_one(conn, {'account_deletion': callback})
        callback.assert_not_called()
        self.assertEqual(conn.execute.call_args.args[2], 'failed')

    async def test_parent_cleanup_callback_is_registered_without_wrapper_grants(self):
        from shared.account_cleanup import process_account_deletion
        self.assertIs(extra_job_handlers()['account_deletion'], process_account_deletion)

    async def test_long_running_job_lease_is_renewed_with_claim_generation(self):
        conn = connection()
        pool = MagicMock()
        pool.acquire.return_value = Acquire(conn)
        count = 0
        async def tick(coroutine, **kwargs):
            nonlocal count
            coroutine.close()
            count += 1
            if count == 1:
                raise TimeoutError
        with patch('backend.worker.app.main.asyncio.wait_for', side_effect=tick):
            await keep_job_lease(pool, self.job(), asyncio.Event())
        sql, job_id, generation = conn.execute.call_args.args
        self.assertIn('locked_at=now()', sql)
        self.assertIn("status='running' AND attempts=$2", sql)
        self.assertEqual((job_id, generation), ('job-1', 1))

    async def test_pool_is_created_once_and_closed_on_stop(self):
        conn = connection()
        pool = MagicMock()
        pool.acquire.return_value = Acquire(conn)
        pool.close = AsyncMock()
        async def stop_after_idle(coroutine, **kwargs):
            coroutine.close()
            raise asyncio.CancelledError
        with patch.dict('os.environ', {'DATABASE_URL': 'postgresql://test.invalid/test', 'NEON_DATABASE_URL': ''}), \
             patch('backend.worker.app.main.extra_job_handlers', return_value={}), \
             patch('backend.worker.app.main.asyncpg.create_pool', AsyncMock(return_value=pool)) as create, \
             patch('backend.worker.app.main.process_one', AsyncMock(return_value=False)), \
             patch('backend.worker.app.main.send_pending', AsyncMock(return_value=False)), \
             patch('backend.worker.app.main.reconcile_receipts', AsyncMock(return_value=False)), \
             patch('backend.worker.app.main.asyncio.wait_for', side_effect=stop_after_idle):
            with self.assertRaises(asyncio.CancelledError):
                await run()
        create.assert_awaited_once()
        pool.close.assert_awaited_once()

    async def test_push_reconciliation_is_not_blocked_by_account_media_cleanup(self):
        conn = connection()
        pool = MagicMock()
        pool.acquire.return_value = Acquire(conn)
        pool.close = AsyncMock()
        running = asyncio.Event()
        blocked = asyncio.Event()
        cancelled = asyncio.Event()
        async def slow_job(*args):
            running.set()
            try:
                await blocked.wait()
            finally:
                cancelled.set()
        async def process_push(*args):
            await running.wait()
            self.assertFalse(blocked.is_set())
            raise asyncio.CancelledError
        with patch.dict('os.environ', {'DATABASE_URL': 'postgresql://test.invalid/test', 'NEON_DATABASE_URL': ''}), \
             patch('backend.worker.app.main.extra_job_handlers', return_value={}), \
             patch('backend.worker.app.main.asyncpg.create_pool', AsyncMock(return_value=pool)), \
             patch('backend.worker.app.main.process_one', side_effect=slow_job), \
             patch('backend.worker.app.main.send_pending', side_effect=process_push) as push:
            with self.assertRaises(asyncio.CancelledError):
                await run()
        push.assert_awaited_once()
        self.assertTrue(cancelled.is_set())
        pool.close.assert_awaited_once()
