import asyncio
import hashlib
import pathlib

from .config import get_settings
from .database import connect, close_pools


async def migrate() -> None:
    settings = get_settings()
    conn = await connect(settings)
    try:
        await conn.execute("SELECT pg_advisory_lock(90412026)")
        await conn.execute("CREATE TABLE IF NOT EXISTS api_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())")
        directory = pathlib.Path(__file__).resolve().parents[1] / "migrations"
        for path in sorted(directory.glob("*.sql")):
            source = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(source.encode()).hexdigest()
            applied = await conn.fetchval("SELECT checksum FROM api_schema_migrations WHERE name=$1", path.name)
            if applied:
                if applied != checksum:
                    raise RuntimeError(f"Applied migration has changed: {path.name}")
                continue
            async with conn.transaction():
                await conn.execute(source)
                await conn.execute("INSERT INTO api_schema_migrations (name, checksum) VALUES ($1, $2)", path.name, checksum)
            print(f"Applied {path.name}")
    finally:
        await conn.execute("SELECT pg_advisory_unlock(90412026)")
        await conn.close()
        await close_pools()


if __name__ == "__main__":
    asyncio.run(migrate())
