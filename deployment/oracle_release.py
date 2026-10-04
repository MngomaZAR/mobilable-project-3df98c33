"""Rehearse an immutable backend release against a protected production backup.

Run on the Oracle host as root. This deliberately does not publish a mobile build,
replace production, or copy the QA database into production.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit, urlunsplit

LOG_DIRECTORY = None


def command(arguments, *, data=None):
    result = subprocess.run(arguments, input=data, capture_output=True, check=False)
    if result.returncode:
        # Docker/Compose errors can contain resolved credentials and database rows.
        if LOG_DIRECTORY is not None:
            log = LOG_DIRECTORY / "command-failure.log"
            with log.open("wb") as stream:
                os.chmod(log, 0o600)
                stream.write(result.stdout + b"\n" + result.stderr)
        raise RuntimeError(f"Command failed: {arguments[0]} {arguments[1]} (exit {result.returncode})")
    return result.stdout


def inspect(name):
    return json.loads(command(["docker", "inspect", name]))[0]


def environment(container):
    return dict(item.split("=", 1) for item in container["Config"].get("Env", []))


def validate_image(image, service, revision):
    pattern = rf"ghcr\.io/mngomazar/papzi-{service}@sha256:[0-9a-f]{{64}}"
    if not re.fullmatch(pattern, image):
        raise ValueError("Expected the exact Papzi GHCR image digest")
    details = inspect(image)
    label = (details["Config"].get("Labels") or {}).get("org.opencontainers.image.revision")
    if label != revision:
        raise ValueError("Candidate image source revision does not match")
    return details


def private_json(path, value):
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with destination.open("x", encoding="utf-8") as stream:
        os.chmod(destination, 0o600)
        json.dump(value, stream, indent=2)
        stream.write("\n")


def database_source(api, postgres):
    env = environment(api)
    parsed = urlsplit(env.get("NEON_DATABASE_URL") or env["DATABASE_URL"])
    database = parsed.path.lstrip("/")
    if parsed.hostname not in {"postgres", "papzii-postgres"} or not re.fullmatch(r"[a-z][a-z0-9_]*", database):
        raise ValueError("Expected the existing local Oracle production database")
    if any(word in database for word in ("qa", "restore", "test")):
        raise ValueError("Refusing a QA or restore database as the production source")
    pg = environment(postgres)
    if parsed.username != pg.get("POSTGRES_USER") or parsed.password != pg.get("POSTGRES_PASSWORD"):
        raise ValueError("Running API and PostgreSQL credentials are not aligned")
    return database, pg["POSTGRES_USER"], env, parsed


def sql(user, database, query):
    return command(["docker", "exec", "-i", "papzii-postgres", "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", database], data=query.encode()).decode().strip()


def identities(user, database):
    tables = json.loads(sql(user, database, "SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public';"))
    protected = ("api_users", "profiles", "photographers", "models", "bookings", "messages", "payments", "earnings", "kyc_documents", "portfolio_media")
    result = {}
    for table in protected:
        if table in tables:
            result[table] = json.loads(sql(user, database, f"SELECT json_build_object('count',count(*),'identity_digest',md5(coalesce(string_agg(id::text,',' ORDER BY id::text),''))) FROM {table};"))
    if "api_users" in tables:
        result["auth_credentials"] = sql(user, database, "SELECT md5(coalesce(string_agg(concat_ws(':',id,email,password_hash,metadata::text,email_verified::text),'|' ORDER BY id),'')) FROM api_users;")
    if "api_sessions" in tables:
        # Compare session identity/expiry while the migration fingerprints raw tokens.
        result["sessions"] = json.loads(sql(user, database, "SELECT json_build_object('count',count(*),'identity_digest',md5(coalesce(string_agg(concat_ws(':',user_id,expires_at::text,refresh_expires_at::text),'|' ORDER BY user_id,expires_at,refresh_expires_at),''))) FROM api_sessions;"))
    return result


def identities_preserved(before, after):
    if any(after.get(key) != value for key, value in before.items()):
        return False
    return all(isinstance(value, dict) and value.get("count") == 0
               for key, value in after.items() if key not in before)


def dispatch_archive_identity(user, database):
    # After the first release, fingerprint the preserved archive, not new offers.
    for table in ("papzii_legacy.dispatch_offers", "public.dispatch_offers"):
        if sql(user, database, f"SELECT to_regclass('{table}') IS NOT NULL;") == "t":
            return sql(user, database, f"SELECT md5(coalesce(string_agg(to_jsonb(d)::text,'|' ORDER BY id),'')) FROM {table} d;")
    return None


def runtime_env(source, *, database_url, public_url, revision, proxy_ip):
    env = dict(source)
    for key in ("NEON_DATABASE_URL", "NHOST_GRAPHQL_URL", "NHOST_AUTH_URL", "NHOST_ADMIN_SECRET"):
        env.pop(key, None)
    env.update({"DATABASE_URL": database_url, "APP_ENV": "qa-restore", "APP_VERSION": revision,
                "API_PUBLIC_URL": public_url, "ALLOW_RUNTIME_SCHEMA_CHANGES": "false",
                "OSRM_BASE_URL": "http://papzii-osrm:5000", "FORWARDED_ALLOW_IPS": proxy_ip,
                "WEB_CONCURRENCY": "2"})
    # Keep optional integrations absent rather than turning QA mocks into live providers.
    return env


def write_env(path, env):
    with Path(path).open("x", encoding="utf-8") as stream:
        os.chmod(path, 0o600)
        for key, value in sorted(env.items()):
            if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or "\n" in value or "\r" in value:
                raise ValueError("Invalid Docker environment entry")
            stream.write(f"{key}={value}\n")


def rehearse(args):
    global LOG_DIRECTORY
    if os.geteuid() != 0:
        raise ValueError("Run on the Oracle host as root")
    os.umask(0o077)
    if not re.fullmatch(r"[0-9a-f]{40}", args.revision):
        raise ValueError("Expected a full source revision")
    api, worker, postgres, proxy = (inspect(name) for name in ("papzii-api", "papzii-worker-1", "papzii-postgres", "dokploy-traefik"))
    database, user, env, parsed = database_source(api, postgres)
    api_labels = api["Config"].get("Labels") or {}
    if api_labels.get("com.docker.compose.project") != "papzii":
        raise ValueError("Expected the existing papzii Compose project")
    mounts = {m.get("Name") for m in postgres["Mounts"]}
    if "papzii_papzii-postgres-data" not in mounts:
        raise ValueError("Production PostgreSQL volume is not the expected preserved volume")
    if "dokploy-network" not in api["NetworkSettings"]["Networks"]:
        raise ValueError("Production API must retain its public proxy network")
    proxy_ip = proxy["NetworkSettings"]["Networks"]["dokploy-network"]["IPAddress"]
    route_file = Path("/etc/dokploy/traefik/dynamic/papzii-api.yml")
    route = route_file.read_text()
    if "http://papzii-api:8000" not in route:
        raise ValueError("Public HTTPS route is not bound to the stable API container name")
    public_url = env["API_PUBLIC_URL"]
    if urlsplit(public_url).scheme != "https" or urlsplit(public_url).hostname != "papzii-api.129.151.188.15.nip.io":
        raise ValueError("Unexpected public API destination")
    for image, service in ((args.api_image, "api"), (args.worker_image, "worker")):
        command(["docker", "pull", image])
        validate_image(image, service, args.revision)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    root = Path("/var/backups/papzii") / f"release-{stamp}"
    root.mkdir(parents=True, mode=0o700)
    LOG_DIRECTORY = root
    dump = root / "production.dump"
    # Stream the binary dump directly into a root-only file, never through logs.
    with dump.open("xb") as stream:
        os.chmod(dump, 0o600)
        result = subprocess.run(["docker", "exec", "papzii-postgres", "pg_dump", "-U", user, "-Fc", database], stdout=stream, stderr=subprocess.PIPE)
    if result.returncode or dump.stat().st_size == 0:
        raise RuntimeError("Production database backup failed")
    checksum = hashlib.sha256()
    with dump.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    digest = checksum.hexdigest()
    source_config = json.loads(command(["docker", "compose", "--project-directory", "/opt/papzii", "-f", "/opt/papzii/docker-compose.yml", "config", "--format", "json"]))
    private_json(root / "previous-compose.json", source_config)
    private_json(root / "running-environment.json", {"api": env, "worker": environment(worker)})
    restored = f"papzii_qa_restore_{stamp.lower()}"
    command(["docker", "exec", "papzii-postgres", "createdb", "-U", user, restored])
    with dump.open("rb") as stream:
        result = subprocess.run(["docker", "exec", "-i", "papzii-postgres", "pg_restore", "-U", user, "-d", restored, "--no-owner", "--exit-on-error"], stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError("Production backup restoration failed")
    before = identities(user, restored)
    restore_env = root / "restore.env"
    restored_url = urlunsplit(parsed._replace(path="/" + restored))
    candidate_env = runtime_env(env, database_url=restored_url, public_url=public_url, revision=args.revision, proxy_ip=proxy_ip)
    write_env(restore_env, candidate_env)
    legacy_identity = dispatch_archive_identity(user, restored)
    compatibility = Path(args.compatibility_sql).read_text(encoding="utf-8")
    sql(user, restored, compatibility)
    legacy_preserved = False
    if sql(user, restored, "SELECT to_regclass('papzii_legacy.dispatch_offers') IS NOT NULL;") == "t":
        archived = sql(user, restored, "SELECT md5(coalesce(string_agg(to_jsonb(d)::text,'|' ORDER BY id),'')) FROM papzii_legacy.dispatch_offers d;")
        if archived != legacy_identity:
            raise RuntimeError("Archived dispatch offer records do not match the restored backup")
        legacy_preserved = True
    docker = ["docker", "run", "--rm", "--network", "papzii_default", "--env-file", str(restore_env), args.api_image]
    command([*docker, "python", "-m", "app.migrate"])
    contract = json.loads(command([*docker, "python", "-c", "import asyncio,json; from app.config import get_settings; from app.main import REQUIRED_SCHEMA_COLUMNS; from app.database import schema_contract_status; print(json.dumps(asyncio.run(schema_contract_status(get_settings(),REQUIRED_SCHEMA_COLUMNS))))"]))
    if not contract.get("ok"):
        raise RuntimeError("Restored candidate schema contract is not complete")
    after = identities(user, restored)
    if not identities_preserved(before, after):
        raise RuntimeError("Migration changed protected account or business-record identities")
    migrations = json.loads(sql(user, restored, "SELECT json_agg(name ORDER BY name) FROM api_schema_migrations;"))
    receipt = {"checked_at": stamp, "production_replaced": False, "revision": args.revision,
               "api_image": args.api_image, "worker_image": args.worker_image,
               "previous_api_image": api["Config"]["Image"], "previous_worker_image": worker["Config"]["Image"],
               "public_api": public_url, "backup": str(dump), "backup_sha256": digest,
               "restored_database": restored, "schema_contract_ok": True, "identity_and_credentials_preserved": True,
               "legacy_dispatch_preserved": legacy_preserved,
               "compatibility_sql_sha256": hashlib.sha256(compatibility.encode()).hexdigest(),
               "migrations": migrations, "source_database": database,
               "preserved_volume": "papzii_papzii-postgres-data",
               "trusted_proxy": proxy_ip, "protected_record_counts": {k: v["count"] for k,v in after.items() if isinstance(v, dict)},
               "integration_configuration": {k: bool(env.get(k)) for k in ("PAYFAST_MERCHANT_ID", "PAYFAST_MERCHANT_KEY", "PAYFAST_PASSPHRASE", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "ADMIN_USER_IDS")}}
    private_json(root / "rehearsal.json", receipt)
    print(json.dumps(receipt, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--api-image", required=True)
    parser.add_argument("--worker-image", required=True)
    parser.add_argument("--compatibility-sql", default=str(Path(__file__).parent / "sql" / "preserve_legacy_dispatch.sql"))
    args = parser.parse_args()
    try:
        rehearse(args)
    except (RuntimeError, ValueError, KeyError, OSError):
        print(json.dumps({"production_replaced": False, "reason": "release_rehearsal_failed", "details": "Root-only backup and logs remain on Oracle; no production replacement was attempted."}))
        raise


if __name__ == "__main__":
    main()
