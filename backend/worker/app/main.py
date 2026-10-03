import asyncio
import logging
import json
import os
import signal
import uuid

import asyncpg
import httpx
from shared.recovery_mail import decrypt_reset_token, send_reset_email


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("papzi-worker")


async def process_notification(conn, job) -> None:
    payload = json.loads(job["payload"]) if isinstance(job["payload"], str) else job["payload"]
    event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"papzi-job:{job['id']}"))
    await conn.execute(
        """INSERT INTO notification_events (id,user_id,event_type,title,body,status,action_payload)
        VALUES ($1,$2,$3,$4,$5,'unread',$6::jsonb) ON CONFLICT (id) DO NOTHING""",
        event_id, payload["user_id"], payload["event_type"], payload["title"], payload["body"], json.dumps(payload),
    )
    tokens = await conn.fetch("SELECT id,expo_push_token FROM push_tokens WHERE user_id=$1 AND enabled=true", payload["user_id"])
    if not tokens:
        return
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if os.getenv("EXPO_ACCESS_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['EXPO_ACCESS_TOKEN']}"
    async with httpx.AsyncClient(timeout=15) as client:
        for start in range(0, len(tokens), 100):
            batch = tokens[start:start + 100]
            messages = [{"to": token["expo_push_token"], "title": payload["title"], "body": payload["body"], "data": {**payload, "notification_id": event_id}, "sound": "default"} for token in batch]
            response = await client.post("https://exp.host/--/api/v2/push/send", json=messages, headers=headers)
            response.raise_for_status()
            tickets = response.json().get("data", [])
            if not isinstance(tickets, list) or len(tickets) != len(batch):
                raise RuntimeError("Invalid Expo push response")
            for token, ticket in zip(batch, tickets):
                if ticket.get("status") == "error":
                    code = ticket.get("details", {}).get("error", "Unknown")
                    if code == "DeviceNotRegistered":
                        await conn.execute("UPDATE push_tokens SET enabled=false WHERE id=$1", token["id"])
                    else:
                        raise RuntimeError(f"Expo push rejected notification: {code}")


async def process_one(conn) -> bool:
    async with conn.transaction():
        job = await conn.fetchrow(
            """WITH candidate AS (SELECT id FROM job_outbox
            WHERE (status='pending' AND available_at<=now()) OR (status='running' AND locked_at<now()-interval '5 minutes')
            ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1)
            UPDATE job_outbox SET status='running',locked_at=now(),attempts=coalesce(attempts,0)+1
            WHERE id=(SELECT id FROM candidate) RETURNING *"""
        )
    if not job:
        return False
    try:
        if job["kind"] == "password_recovery":
            payload = json.loads(job['payload']) if isinstance(job['payload'], str) else job['payload']
            row = await conn.fetchrow(
                """SELECT u.email FROM password_resets r JOIN api_users u ON u.id=r.user_id
                WHERE r.id=$1 AND r.used_at IS NULL AND r.sent_at IS NULL AND r.expires_at>now()""", payload['reset_id'],
            )
            if row:
                token = decrypt_reset_token(os.environ['RECOVERY_ENCRYPTION_KEY'], payload['encrypted_token'])
                await asyncio.to_thread(send_reset_email, os.environ, row['email'], token)
                await conn.execute('UPDATE password_resets SET sent_at=now() WHERE id=$1', payload['reset_id'])
            await conn.execute("UPDATE job_outbox SET payload=$2::jsonb WHERE id=$1", job['id'], json.dumps({'reset_id': payload['reset_id']}))
        elif job["kind"] == "notification":
            await process_notification(conn, job)
        else:
            raise RuntimeError(f"Unsupported job type: {job['kind']}")
        await conn.execute("UPDATE job_outbox SET status='done',updated_at=now(),last_error=NULL WHERE id=$1", job["id"])
    except Exception as error:
        # Store the error class, not payloads, tokens, or financial secrets.
        terminal = job["attempts"] >= (job["max_attempts"] or 8)
        await conn.execute("UPDATE job_outbox SET status=$2,last_error=$3,available_at=now()+$4::int*interval '1 second',locked_at=NULL,updated_at=now() WHERE id=$1",
                           job["id"], "failed" if terminal else "pending", type(error).__name__, min(3600, 2 ** job["attempts"] * 10))
        logger.warning("Job %s attempt %s failed (%s)", job["id"], job["attempts"], type(error).__name__)
    return True


async def run() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    logger.info("PAPZII worker started")
    url = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required for durable jobs")
    while not stop.is_set():
        conn = None
        try:
            conn = await asyncpg.connect(url, timeout=10, command_timeout=20)
            await conn.execute("DELETE FROM auth_rate_limits WHERE expires_at<now()-interval '1 day'")
            await conn.execute("UPDATE bookings SET status='cancelled',updated_at=now() WHERE status='pending' AND hold_expires_at<=now() AND payment_status<>'paid'")
            worked = await process_one(conn)
            if worked:
                continue
        except Exception as error:
            logger.error("Worker connection or schema unavailable (%s)", type(error).__name__)
        finally:
            if conn:
                await conn.close()
        try:
            await asyncio.wait_for(stop.wait(), timeout=5)
        except TimeoutError:
            pass
    logger.info("PAPZII worker stopped")


if __name__ == "__main__":
    asyncio.run(run())
