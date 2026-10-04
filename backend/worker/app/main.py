import asyncio
import logging
import json
import os
import signal
import uuid

import asyncpg
import httpx
from shared.recovery_mail import decrypt_reset_token, send_reset_email
from .push_delivery import reconcile_receipts, send_pending
from .video_delivery import process_video_room_end


logging.basicConfig(level=os.getenv('LOG_LEVEL', 'INFO'))
logger = logging.getLogger('papzi-worker')


async def process_notification(conn, job) -> None:
    payload = json.loads(job['payload']) if isinstance(job['payload'], str) else job['payload']
    event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"papzi-job:{job['id']}"))
    action_type = 'chat' if payload.get('conversation_id') else 'booking' if payload.get('booking_id') else None
    category = 'message' if action_type == 'chat' else 'earnings' if payload['event_type'].startswith(('payment_', 'payout_')) else 'booking' if action_type == 'booking' else 'social'
    async with conn.transaction():
        await conn.execute(
            """INSERT INTO notification_events (id,user_id,event_type,title,body,status,action_payload,action_type,category)
            VALUES ($1,$2,$3,$4,$5,'unread',$6::jsonb,$7,$8) ON CONFLICT (id) DO NOTHING""",
            event_id, payload['user_id'], payload['event_type'], payload['title'], payload['body'], json.dumps(payload), action_type, category,
        )
        await conn.execute(
            """INSERT INTO push_deliveries (id,job_id,token_id,notification_id,expo_push_token)
            SELECT gen_random_uuid()::text,$1,id,$2,expo_push_token FROM push_tokens
            WHERE user_id=$3 AND enabled=true ON CONFLICT (job_id,token_id) DO NOTHING""",
            job['id'], event_id, payload['user_id'],
        )


def extra_job_handlers():
    try:
        from shared.account_cleanup import process_account_deletion
    except ModuleNotFoundError as error:
        if error.name != 'shared.account_cleanup':
            raise
        return {}
    return {'account_deletion': process_account_deletion}


async def keep_job_lease(pool, job, finished):
    while not finished.is_set():
        try:
            await asyncio.wait_for(finished.wait(), timeout=60)
            return
        except TimeoutError:
            try:
                async with pool.acquire() as conn:
                    await conn.execute("UPDATE job_outbox SET locked_at=now() WHERE id=$1 AND status='running' AND attempts=$2", job['id'], job['attempts'])
            except Exception as error:
                logger.warning('Job lease renewal failed (%s)', type(error).__name__)


async def process_one(conn, job_handlers=None, pool=None) -> bool:
    async with conn.transaction():
        job = await conn.fetchrow(
            """WITH candidate AS (SELECT id FROM job_outbox
            WHERE (status='pending' AND available_at<=now()) OR (status='running' AND locked_at<now()-interval '5 minutes')
            ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1)
            UPDATE job_outbox SET status='running',locked_at=now(),attempts=coalesce(attempts,0)+1
            WHERE id=(SELECT id FROM candidate) RETURNING *""",
        )
    if not job:
        return False
    finished = asyncio.Event()
    lease = asyncio.create_task(keep_job_lease(pool, job, finished)) if pool else None
    try:
        if job['attempts'] > (job['max_attempts'] or 8):
            raise RuntimeError('AttemptsExhausted')
        payload = json.loads(job['payload']) if isinstance(job['payload'], str) else job['payload']
        if job['kind'] == 'password_recovery':
            row = await conn.fetchrow(
                """SELECT u.email FROM password_resets r JOIN api_users u ON u.id=r.user_id
                WHERE r.id=$1 AND r.used_at IS NULL AND r.sent_at IS NULL AND r.expires_at>now()""", payload['reset_id'],
            )
            if row:
                token = decrypt_reset_token(os.environ['RECOVERY_ENCRYPTION_KEY'], payload['encrypted_token'])
                await asyncio.to_thread(send_reset_email, os.environ, row['email'], token)
                await conn.execute('UPDATE password_resets SET sent_at=now() WHERE id=$1', payload['reset_id'])
            await conn.execute('UPDATE job_outbox SET payload=$2::jsonb WHERE id=$1 AND attempts=$3', job['id'], json.dumps({'reset_id': payload['reset_id']}), job['attempts'])
        elif job['kind'] == 'notification':
            await process_notification(conn, job)
        elif job['kind'] == 'livekit_room_end':
            await process_video_room_end(conn, payload)
        elif job['kind'] in (job_handlers or {}):
            completed = await job_handlers[job['kind']](conn, payload)
            if job['kind'] == 'account_deletion' and completed is False:
                await conn.execute(
                    """UPDATE job_outbox SET status='pending',available_at=now()+interval '24 hours',
                    attempts=GREATEST(attempts-1,0),locked_at=NULL,last_error='FinancialHold',updated_at=now()
                    WHERE id=$1 AND status='running' AND attempts=$2""", job['id'], job['attempts'],
                )
                return True
            if job['kind'] == 'account_deletion' and completed is not True:
                raise RuntimeError('InvalidDeletionResult')
        else:
            raise RuntimeError('UnsupportedJobType')
        await conn.execute("UPDATE job_outbox SET status='done',locked_at=NULL,updated_at=now(),last_error=NULL WHERE id=$1 AND status='running' AND attempts=$2", job['id'], job['attempts'])
    except Exception as error:
        terminal = job['attempts'] >= (job['max_attempts'] or 8)
        await conn.execute(
            """UPDATE job_outbox SET status=$2,last_error=$3,available_at=now()+$4::int*interval '1 second',
            locked_at=NULL,updated_at=now() WHERE id=$1 AND status='running' AND attempts=$5""",
            job['id'], 'failed' if terminal else 'pending', type(error).__name__, min(3600, 2 ** min(job['attempts'], 8) * 10), job['attempts'],
        )
        logger.warning('Job %s attempt %s failed (%s)', job['id'], job['attempts'], type(error).__name__)
    finally:
        finished.set()
        if lease:
            lease.cancel()
            await asyncio.gather(lease, return_exceptions=True)
    return True


async def run(job_handlers=None) -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass
    url = os.getenv('NEON_DATABASE_URL') or os.getenv('DATABASE_URL')
    if not url:
        raise RuntimeError('DATABASE_URL is required for durable jobs')
    handlers = extra_job_handlers()
    handlers.update(job_handlers or {})
    pool = await asyncpg.create_pool(url, min_size=1, max_size=4, timeout=10, command_timeout=20)
    logger.info('PAPZII worker started')
    async def idle():
        try:
            await asyncio.wait_for(stop.wait(), timeout=5)
        except TimeoutError:
            pass

    async def jobs():
        while not stop.is_set():
            worked = False
            try:
                async with pool.acquire() as conn:
                    worked = await process_one(conn, handlers, pool)
            except Exception as error:
                logger.error('Worker job connection or schema unavailable (%s)', type(error).__name__)
            if not worked:
                await idle()

    async def pushes(client):
        last_maintenance = 0.0
        while not stop.is_set():
            worked = False
            try:
                async with pool.acquire() as conn:
                    if loop.time() - last_maintenance > 60:
                        await conn.execute("DELETE FROM auth_rate_limits WHERE expires_at<now()-interval '1 day'")
                        await conn.execute("UPDATE bookings SET status='cancelled',updated_at=now() WHERE status='pending' AND hold_expires_at<=now() AND payment_status<>'paid'")
                        last_maintenance = loop.time()
                    worked = await send_pending(conn, client)
                    worked = await reconcile_receipts(conn, client) or worked
            except Exception as error:
                logger.error('Worker push connection or schema unavailable (%s)', type(error).__name__)
            if not worked:
                await idle()

    tasks = []
    try:
        async with httpx.AsyncClient(timeout=15, limits=httpx.Limits(max_connections=6)) as client:
            tasks = [asyncio.create_task(jobs()), asyncio.create_task(pushes(client))]
            await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await pool.close()
    logger.info('PAPZII worker stopped')


if __name__ == '__main__':
    asyncio.run(run())
