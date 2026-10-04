"""Apply server-only integration settings without changing a backend release.

Run as root on the existing Oracle host. Read JSON from stdin, never secret CLI
arguments. Credentials and resolved Compose backups remain root-only on Oracle.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

import oracle_release as release
import oracle_promote as promote


ALLOWED = {
    "LIVEKIT_ENABLED", "LIVEKIT_URL", "LIVEKIT_API_URL", "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET", "EXPO_ACCESS_TOKEN", "SMTP_HOST", "SMTP_PORT",
    "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_SSL", "RECOVERY_ENCRYPTION_KEY",
    "PAYFAST_MERCHANT_ID", "PAYFAST_MERCHANT_KEY", "PAYFAST_PASSPHRASE",
    "PAYFAST_SANDBOX", "PAYFAST_CHECKOUT_ENABLED",
}
PAYMENT_SETTINGS = {"PAYFAST_MERCHANT_ID", "PAYFAST_MERCHANT_KEY", "PAYFAST_PASSPHRASE",
                    "PAYFAST_SANDBOX", "PAYFAST_CHECKOUT_ENABLED"}


def validate_updates(updates):
    if not isinstance(updates, dict) or not updates or set(updates) - ALLOWED:
        raise ValueError("Only the allowlisted operational integration settings may change")
    for key, value in updates.items():
        if not isinstance(value, str) or not value or any(char in value for char in "\r\n\x00"):
            raise ValueError("Expected nonempty single-line integration settings")
        if len(value) > 8192:
            raise ValueError("Integration setting is too large")
    for key in ("LIVEKIT_ENABLED", "SMTP_SSL", "PAYFAST_SANDBOX", "PAYFAST_CHECKOUT_ENABLED"):
        if key in updates and updates[key] not in {"true", "false"}:
            raise ValueError("Boolean integration settings must be explicit")
    for key, scheme in (("LIVEKIT_URL", "wss"), ("LIVEKIT_API_URL", "https")):
        if key in updates:
            url = urlsplit(updates[key])
            if url.scheme != scheme or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError("A secure integration endpoint without embedded credentials is required")
    if "SMTP_PORT" in updates and (not updates["SMTP_PORT"].isdigit() or not 1 <= int(updates["SMTP_PORT"]) <= 65535):
        raise ValueError("Invalid SMTP port")
    if set(updates) & PAYMENT_SETTINGS:
        if not PAYMENT_SETTINGS <= set(updates) or updates["PAYFAST_CHECKOUT_ENABLED"] != "false":
            raise ValueError("Merchant settings must be complete and new checkout must remain paused")
    return updates


def configured_compose(config, api_env, worker_env, updates, admin_id=None):
    validate_updates(updates)
    if api_env.get("DATABASE_URL") != worker_env.get("DATABASE_URL"):
        raise ValueError("API and worker must use the same production database")
    result = deepcopy(config)
    for name, runtime in (("api", api_env), ("worker", worker_env)):
        if result["services"][name].get("build"):
            raise ValueError("Configuration-only changes cannot rebuild images")
        env = {**runtime, **updates}
        if ("RECOVERY_ENCRYPTION_KEY" in updates and runtime.get("RECOVERY_ENCRYPTION_KEY")
                and runtime["RECOVERY_ENCRYPTION_KEY"] != updates["RECOVERY_ENCRYPTION_KEY"]):
            raise ValueError("Existing recovery encryption keys require a separate safe rotation")
        if set(updates) & PAYMENT_SETTINGS:
            for key in PAYMENT_SETTINGS - {"PAYFAST_CHECKOUT_ENABLED"}:
                if runtime.get("PAYFAST_MERCHANT_ID") and runtime.get(key) != updates[key]:
                    raise ValueError("Existing merchant settings require a separate reconciled rotation")
        if admin_id is not None:
            if not re.fullmatch(r"[a-zA-Z0-9_-]{1,120}", admin_id):
                raise ValueError("Invalid verified owner identifier")
            existing = {value.strip() for value in runtime.get("ADMIN_USER_IDS", "").split(",") if value.strip()}
            env["ADMIN_USER_IDS"] = ",".join(sorted(existing | {admin_id}))
        result["services"][name]["environment"] = env
    return result


def configure(args, payload):
    if os.geteuid() != 0:
        raise ValueError("Run on Oracle as root")
    if not isinstance(payload, dict) or set(payload) - {"updates", "admin_owner_email"}:
        raise ValueError("Unexpected integration request")
    updates = validate_updates(payload.get("updates"))
    os.umask(0o077)
    api, worker, postgres = (release.inspect(name) for name in ("papzii-api", "papzii-worker-1", "papzii-postgres"))
    database, user, api_env, _ = release.database_source(api, postgres)
    worker_env = release.environment(worker)
    for container, service in ((api, "api"), (worker, "worker")):
        if (container["Config"].get("Labels") or {}).get("com.docker.compose.project") != "papzii":
            raise ValueError("Expected the existing Papzi Compose project")
        release.validate_image(container["Config"]["Image"], service, args.expected_revision)
    if api_env.get("APP_ENV") != "production" or worker_env.get("DATABASE_URL") != api_env.get("DATABASE_URL"):
        raise ValueError("Expected aligned production API and worker")
    if set(updates) & PAYMENT_SETTINGS:
        # Older images ignore unknown env fields and would inadvertently enable charging.
        release.command(["docker", "exec", "papzii-api", "python", "-c",
                         "from app.config import Settings; "
                         "assert 'payfast_checkout_enabled' in Settings.model_fields; "
                         "assert Settings.model_fields['payfast_checkout_enabled'].default is False"])
    compose = Path("/opt/papzii/docker-compose.yml")
    original = compose.read_text()
    config = json.loads(release.command(["docker", "compose", "--project-name", "papzii", "--project-directory", "/opt/papzii", "-f", str(compose), "config", "--format", "json"]))
    for name, container in (("api", api), ("worker", worker)):
        if config["services"][name]["image"] != container["Config"]["Image"]:
            raise ValueError("Compose differs from the running immutable release")
    owner = payload.get("admin_owner_email")
    admin_id = None
    if owner is not None:
        if not isinstance(owner, str) or not re.fullmatch(r"[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+", owner):
            raise ValueError("Invalid owner email")
        rows = json.loads(release.sql(user, database,
            "SELECT coalesce(json_agg(id),'[]') FROM api_users WHERE lower(email)=lower('" + owner + "') "
            "AND email_verified AND coalesce(metadata->>'deletion_status','')=''"))
        if len(rows) != 1:
            raise ValueError("Exactly one verified active owner account is required")
        admin_id = rows[0]
    candidate = configured_compose(config, api_env, worker_env, updates, admin_id)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    root = Path("/var/backups/papzii") / f"configuration-{stamp}"
    root.mkdir(mode=0o700)
    release.LOG_DIRECTORY = root
    release.private_json(root / "previous-compose.json", config)
    (root / "previous-compose.yml").write_text(original)
    release.private_json(root / "candidate-compose.json", candidate)
    try:
        promote.replace_file(compose, json.dumps(candidate, indent=2) + "\n")
        promote.start_services(compose)
        evidence = promote.internal_acceptance(args.expected_revision)
        for name in ("papzii-api", "papzii-worker-1"):
            current = release.environment(release.inspect(name))
            if any(current.get(key) != value for key, value in updates.items()):
                raise RuntimeError("Integration settings were not applied to both services")
            if current.get("DATABASE_URL") != api_env["DATABASE_URL"]:
                raise RuntimeError("Configuration changed the production database")
        result = {"checked_at": stamp, "revision": args.expected_revision, "database_preserved": True,
                  "images_preserved": True, "configured_keys": sorted(updates),
                  "verified_owner_admin_added": admin_id is not None,
                  "backup_directory": str(root), "readiness": evidence["readiness"],
                  "store_release_started": False}
        release.private_json(root / "configuration.json", result)
        print(json.dumps(result))
    except Exception:
        # No database rollback: this operation changes no schema or records.
        promote.replace_file(compose, original)
        promote.start_services(compose)
        promote.internal_acceptance(args.expected_revision)
        raise RuntimeError("Integration update failed; previous runtime configuration restored") from None


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-revision", required=True)
    args = parser.parse_args()
    try:
        import fcntl
        lock = Path("/var/run/papzii-release.lock").open("a")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = sys.stdin.read(65537)
        if len(raw) > 65536:
            raise ValueError("Integration request is too large")
        configure(args, json.loads(raw))
    except Exception as error:
        print(json.dumps({"ok": False, "error_type": type(error).__name__,
                          "message": "Configuration failed; private details remain on Oracle"}))
        raise SystemExit(1)
