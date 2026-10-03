"""Isolated PostgreSQL protocol fixtures; never read the repository .env.

Run: python dispatch_protocol.py --database-url postgresql://user@127.0.0.1:PORT/postgres
Only an explicitly supplied loopback database is permitted. Each test uses and drops
its own generated schema, applying migrations 001-007 without changing QA data.
"""

import argparse
import os
import unittest
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

import asyncpg

from app import booking_engine, contracts, dispatch_engine
from app.booking_engine import BookingInput, ZA_TIME
from app.config import Settings
from app.dispatch_engine import DispatchCreate


TEST_DATABASE_ENV = "PAPZII_DISPATCH_TEST_DATABASE_URL"


def loopback_database(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Protocol tests require an explicitly supplied loopback PostgreSQL database.")
    return url


@unittest.skipUnless(os.environ.get(TEST_DATABASE_ENV), "Explicit isolated loopback PostgreSQL URL not supplied")
class DatabaseCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.url = loopback_database(os.environ[TEST_DATABASE_ENV])
        self.schema = "dispatch_test_" + uuid.uuid4().hex
        self.settings = Settings(_env_file=None, DATABASE_URL="postgresql://unused", COMMISSION_RATE=0.2)
        admin = await asyncpg.connect(self.url)
        try:
            public_relations = await admin.fetchval(
                "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f'))"
            )
            if public_relations:
                raise ValueError("A fresh isolated database is required; refusing to resolve migrations against existing public relations.")
            await admin.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public")
            await admin.execute(f'CREATE SCHEMA "{self.schema}"')
            await admin.execute("SELECT set_config('search_path',$1,false)", self.schema + ",public")
            migrations = Path(__file__).resolve().parents[1] / "migrations"
            for migration in sorted(migrations.glob("*.sql")):
                if migration.name[:12] <= "202610030007":
                    await admin.execute(migration.read_text(encoding="utf-8"))
        except BaseException:
            await admin.execute(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE')
            raise
        finally:
            await admin.close()
        self.patches = [patch.object(module, "connect", side_effect=self.connection) for module in (booking_engine, dispatch_engine, contracts)]
        for mocked in self.patches:
            mocked.start()
        self.addAsyncCleanup(self.cleanup)
        now = datetime.now(UTC)
        start = (now + timedelta(minutes=30)).astimezone(ZA_TIME)
        if start.hour >= 23:
            start = (start + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
        self.start = start.astimezone(UTC)
        conn = await self.connection()
        try:
            for actor, role in (("client", "client"), ("outsider", "client"), ("p1", "photographer"), ("p2", "photographer"), ("p3", "photographer"), ("p4", "photographer"), ("m1", "model"), ("m2", "model")):
                await conn.execute("INSERT INTO api_users (id,email,password_hash) VALUES ($1,$2,'unused-protocol-hash')", actor, f"{actor}@example.invalid")
                await conn.execute("INSERT INTO profiles (id,role,kyc_status,age_verified,verified,availability_status) VALUES ($1,$2,'approved',true,true,'online')", actor, role)
                if role == "client":
                    continue
                table = "models" if role == "model" else "photographers"
                await conn.execute(f"INSERT INTO {table} (id,is_online,latitude,longitude,travel_radius,hourly_rate,tier_id) VALUES ($1,true,-29.85,31.03,50,1400,'standard')", actor)
                await conn.execute("INSERT INTO location_tracks (id,user_id,role,latitude,longitude,accuracy_m,source,created_at) VALUES ($1,$2,$3,-29.85,31.03,10,'app',now())", str(uuid.uuid4()), actor, role)
                for day in range(7):
                    await conn.execute("INSERT INTO availability (id,user_id,day_of_week,start_time,end_time,is_available) VALUES ($1,$2,$3,'00:00','23:59',true)", str(uuid.uuid4()), actor, day)
                if role == "model":
                    await conn.execute("INSERT INTO model_services (id,model_id,service_type,rate_zar,is_active,requires_age_verification) VALUES ($1,$2,'product_shoot',1400,true,false)", str(uuid.uuid4()), actor)
        finally:
            await conn.close()

    async def connection(self, *_args):
        conn = await asyncpg.connect(self.url)
        await conn.execute("SELECT set_config('search_path',$1,false)", self.schema + ",public")
        await conn.execute("SET statement_timeout='15s'")
        return conn

    async def cleanup(self):
        for mocked in self.patches:
            mocked.stop()
        conn = await asyncpg.connect(self.url)
        try:
            if not self.schema.startswith("dispatch_test_") or len(self.schema) != 46:
                raise RuntimeError("Refusing to drop an unexpected test schema")
            await conn.execute(f'DROP SCHEMA "{self.schema}" CASCADE')
        finally:
            await conn.close()

    async def sql(self, query: str, *args):
        conn = await self.connection()
        try:
            return await conn.execute(query, *args)
        finally:
            await conn.close()

    async def row(self, query: str, *args):
        conn = await self.connection()
        try:
            return await conn.fetchrow(query, *args)
        finally:
            await conn.close()

    async def pending(self, provider="p1", **overrides):
        model = provider.startswith("m")
        command = BookingInput.model_validate({
            "photographer_id": None if model else provider, "model_id": provider if model else None,
            "package_id": None if model else "standard", "model_service_type": "product_shoot" if model else None,
            "start_datetime": self.start, "end_datetime": self.start + timedelta(hours=1),
            "user_latitude": -29.85, "user_longitude": 31.03, "idempotency_key": str(uuid.uuid4()), **overrides,
        })
        return await booking_engine.create_booking(self.settings, command, {"id": "client"})

    async def dispatched(self, provider="p1", **overrides):
        booking = await self.pending(provider)
        command = DispatchCreate(booking_id=booking["id"], fanout_count=20, intensity_level=1, **overrides)
        result = await dispatch_engine.create_dispatch(self.settings, command, {"id": "client"})
        return booking, command, result

    async def accepted_booking(self, provider="p1"):
        booking = await self.pending(provider)
        return await booking_engine.transition_booking(self.settings, booking["id"], "accepted", {"id": provider})

    def assert_http(self, status):
        from fastapi import HTTPException

        case = self

        class ExpectedHttp:
            def __enter__(self):
                return self

            def __exit__(self, kind, value, traceback):
                if kind is None:
                    case.fail(f"Expected HTTP {status}")
                if not isinstance(value, HTTPException):
                    return False
                case.assertEqual(value.status_code, status)
                return True

        return ExpectedHttp()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    options = parser.parse_args()
    os.environ[TEST_DATABASE_ENV] = loopback_database(options.database_url)
    # The base class was initially imported without the explicit test URL.
    DatabaseCase.__unittest_skip__ = False
    suite = unittest.TestSuite()
    loader = unittest.TestLoader()
    for pattern in ("test_dispatch_engine.py", "test_contracts.py"):
        suite.addTests(loader.discover(str(Path(__file__).parent), pattern=pattern))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
