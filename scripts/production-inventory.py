"""Print configuration presence and schema metadata without secret values or user data."""
import asyncio
import json
import os
import sys

from app.config import get_settings
from app.database import connect


async def main():
    if '--configuration-only' in sys.argv:
        names = ['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY', 'PAYFAST_PASSPHRASE', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'RECOVERY_ENCRYPTION_KEY', 'ADMIN_USER_IDS']
        print(json.dumps({key: bool(os.getenv(key)) for key in names}))
        return
    settings = get_settings()
    fields = ("postgres_url", "minio_endpoint", "minio_access_key", "minio_secret_key", "payfast_merchant_id", "payfast_merchant_key", "payfast_passphrase", "livekit_url", "osrm_base_url", "openrouteservice_api_key", "admin_user_ids")
    conn = await connect(settings)
    try:
        rows = await conn.fetch("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position")
        tables = {}
        for row in rows:
            tables.setdefault(row["table_name"], {})[row["column_name"]] = row["data_type"]
        print(json.dumps({"environment": settings.app_env, "configured": {field: bool(getattr(settings, field, "")) for field in fields}, "schema": tables}))
    finally:
        await conn.close()


asyncio.run(main())
