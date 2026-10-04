"""Promote a rehearsed backend without replacing users with QA fixtures.

Public requests receive 503 during the database cutover. Rollback restores the
frozen backup into a separate database, never drops the original database, and
never silently discards writes after public traffic has resumed.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit

import oracle_release as release


MAINTENANCE_NAME = "papzii-release-maintenance"
MAINTENANCE_SERVER = """
from http.server import BaseHTTPRequestHandler, HTTPServer
class Maintenance(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(503)
        self.send_header('Content-Type','application/json')
        self.send_header('Retry-After','30')
        self.end_headers()
        self.wfile.write(b'{"detail":"Scheduled backend maintenance. Please retry shortly."}')
    do_POST=do_GET
    do_PUT=do_GET
    do_PATCH=do_GET
    do_DELETE=do_GET
    do_OPTIONS=do_GET
    do_HEAD=do_GET
    def log_message(self,*args): pass
HTTPServer(('0.0.0.0',8000),Maintenance).serve_forever()
"""


def replace_file(path, content):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".release-tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        os.chmod(temporary, 0o600)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def wait_http(url, status, *, version=None):
    for _ in range(30):
        try:
            with urlopen(url, timeout=5) as response:
                body = json.load(response)
                if response.status == status and (version is None or body.get("version") == version):
                    return body
        except HTTPError as error:
            if error.code == status and version is None:
                return {"status": status}
        except (URLError, TimeoutError, ValueError, OSError):
            pass
        time.sleep(2)
    raise RuntimeError("Public proxy did not reach the expected release state")


def compose_env(config, api_env, worker_env, api_image, worker_image):
    result = json.loads(json.dumps(config))
    for name, image, env in (("api", api_image, api_env), ("worker", worker_image, worker_env)):
        result["services"][name].pop("build", None)
        result["services"][name].update({"image": image, "environment": env, "init": True})
    return result


def backup_database(path, user, database):
    with path.open("xb") as stream:
        os.chmod(path, 0o600)
        result = subprocess.run(["docker", "exec", "papzii-postgres", "pg_dump", "-U", user, "-Fc", database], stdout=stream, stderr=subprocess.PIPE)
    if result.returncode or not path.stat().st_size:
        raise RuntimeError("Frozen production backup failed")


def start_services(compose):
    release.command(["docker", "compose", "--project-name", "papzii", "--project-directory", "/opt/papzii", "-f", str(compose), "up", "-d", "--no-deps", "--no-build", "--pull", "never", "api", "worker"])


def internal_acceptance(revision):
    probe = """
import json
from urllib.request import urlopen
from urllib.error import HTTPError
def get(path):
    with urlopen('http://127.0.0.1:8000'+path,timeout=15) as response:
        assert response.status==200
        return json.load(response)
health=get('/health')
assert health['status']=='ok'
contract=get('/health/contract')
assert contract['ok']
route=get('/routing/route?start_lat=-29.85&start_lng=31.03&end_lat=-29.87&end_lng=31.04')
assert len(route['coordinates'])>2 and route['distance']>0 and route['duration']>0
try:
    get('/auth/me')
except HTTPError as error:
    assert error.code==401
else:
    raise AssertionError('Anonymous auth/me must reject access')
print(json.dumps({'health':health,'version':get('/version'),'schema_ok':contract['ok'],'route_points':len(route['coordinates']),'route_distance':route['distance'],'unauthenticated_rejected':True,'readiness':get('/health/readiness')}))
"""
    for _ in range(30):
        try:
            result = json.loads(release.command(["docker", "exec", "papzii-api", "python", "-c", probe]))
            if result["version"].get("version") != revision:
                raise RuntimeError("The running API revision is not the candidate")
            worker = release.inspect("papzii-worker-1")
            if worker["State"]["Status"] != "running" or worker["RestartCount"]:
                raise RuntimeError("The matching worker is not stable")
            return result
        except (RuntimeError, ValueError, KeyError):
            time.sleep(2)
    raise RuntimeError("Candidate backend failed private cutover probes")


def restore_clone(dump, user, database):
    release.command(["docker", "exec", "papzii-postgres", "createdb", "-U", user, database])
    with dump.open("rb") as stream:
        result = subprocess.run(["docker", "exec", "-i", "papzii-postgres", "pg_restore", "-U", user, "-d", database, "--no-owner", "--exit-on-error"], stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError("Protected rollback restore failed; public maintenance remains enabled")


def promote(args):
    if os.geteuid() != 0:
        raise ValueError("Run on Oracle as root")
    os.umask(0o077)
    receipt_path = Path(args.rehearsal).resolve()
    if not receipt_path.is_relative_to(Path("/var/backups/papzii")) or receipt_path.stat().st_uid != 0 or receipt_path.stat().st_mode & 0o077:
        raise ValueError("Expected a root-only Oracle rehearsal receipt")
    receipt = json.loads(receipt_path.read_text())
    if not all(receipt.get(key) for key in ("schema_contract_ok", "identity_and_credentials_preserved")):
        raise ValueError("A successful backup restoration rehearsal is required")
    api, worker, postgres, proxy = (release.inspect(name) for name in ("papzii-api", "papzii-worker-1", "papzii-postgres", "dokploy-traefik"))
    database, user, source_env, parsed = release.database_source(api, postgres)
    if database != receipt["source_database"] or api["Config"]["Image"] != receipt["previous_api_image"] or worker["Config"]["Image"] != receipt["previous_worker_image"]:
        raise ValueError("Production changed after the rehearsal; rehearse again")
    compatibility = Path(args.compatibility_sql).read_text()
    if hashlib.sha256(compatibility.encode()).hexdigest() != receipt["compatibility_sql_sha256"]:
        raise ValueError("Compatibility SQL changed after rehearsal")
    revision, api_image, worker_image = (receipt[key] for key in ("revision", "api_image", "worker_image"))
    release.validate_image(api_image, "api", revision)
    release.validate_image(worker_image, "worker", revision)
    proxy_ip = proxy["NetworkSettings"]["Networks"]["dokploy-network"]["IPAddress"]
    compose = Path("/opt/papzii/docker-compose.yml")
    original = compose.read_text()
    config = json.loads(release.command(["docker", "compose", "--project-name", "papzii", "--project-directory", "/opt/papzii", "-f", str(compose), "config", "--format", "json"]))
    route_path = Path("/etc/dokploy/traefik/dynamic/papzii-api.yml")
    route = route_path.read_text()
    if route.count("http://papzii-api:8000") != 1:
        raise ValueError("Unexpected public HTTPS proxy definition")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    root = Path("/var/backups/papzii") / f"cutover-{stamp}"
    root.mkdir(mode=0o700)
    release.LOG_DIRECTORY = root
    release.private_json(root / "previous-compose.json", config)
    release.private_json(root / "previous-runtime.json", {"api": source_env, "worker": release.environment(worker)})
    (root / "previous-compose.yml").write_text(original)
    (root / "previous-proxy.yml").write_text(route)
    public_url = receipt["public_api"].rstrip("/")
    frozen = root / "production-frozen.dump"
    stopped = migrated = reopened = False
    try:
        release.command(["docker", "run", "-d", "--name", MAINTENANCE_NAME, "--network", "dokploy-network", api_image, "python", "-c", MAINTENANCE_SERVER])
        replace_file(route_path, route.replace("http://papzii-api:8000", f"http://{MAINTENANCE_NAME}:8000"))
        wait_http(public_url + "/health", 503)
        release.command(["docker", "stop", "papzii-api", "papzii-worker-1"])
        stopped = True
        backup_database(frozen, user, database)
        before = release.identities(user, database)
        minio = release.inspect("papzii-minio-1")
        volume = next(m for m in minio["Mounts"] if m["Destination"] == "/data")
        if volume.get("Name") != "papzii_papzii-minio-data":
            raise ValueError("Unexpected production object-storage volume")
        release.command(["tar", "-C", volume["Source"], "-czf", str(root / "object-storage.tar.gz"), "."])
        candidate = release.runtime_env(source_env, database_url=urlunsplit(parsed), public_url=public_url, revision=revision, proxy_ip=proxy_ip)
        candidate["APP_ENV"] = "production"
        candidate_worker = {**release.environment(worker), **candidate}
        envfile = root / "candidate.env"
        release.write_env(envfile, candidate)
        # Mark before the first DDL statement so a partial migration also restores.
        migrated = True
        release.sql(user, database, compatibility)
        release.command(["docker", "run", "--rm", "--network", "papzii_default", "--env-file", str(envfile), api_image, "python", "-m", "app.migrate"])
        if not release.identities_preserved(before, release.identities(user, database)):
            raise RuntimeError("Production identities changed unexpectedly")
        candidate_config = compose_env(config, candidate, candidate_worker, api_image, worker_image)
        replace_file(compose, json.dumps(candidate_config, indent=2) + "\n")
        start_services(compose)
        evidence = internal_acceptance(revision)
        replace_file(route_path, route)
        reopened = True
        health = wait_http(public_url + "/health", 200)
        public_version = wait_http(public_url + "/version", 200, version=revision)
        with frozen.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        result = {"checked_at": stamp, "production_replaced": True, "revision": revision,
                  "api_image": api_image, "worker_image": worker_image, "public_api": public_url,
                  "rehearsal": str(receipt_path), "frozen_backup_sha256": digest,
                  "backup_directory": str(root), "identities_preserved": True,
                  "object_storage_backed_up": True, "schema_ok": evidence["schema_ok"],
                  "road_route_points": evidence["route_points"], "unauthenticated_rejected": evidence["unauthenticated_rejected"],
                  "readiness": evidence["readiness"], "public_health": health, "public_version": public_version,
                  "public_store_release": False, "mobile_build_started": False}
        release.private_json(root / "promotion.json", result)
        release.command(["docker", "rm", "-f", MAINTENANCE_NAME])
        print(json.dumps(result, indent=2))
    except Exception:
        if reopened:
            print(json.dumps({"reason": "post_cutover_probe_failed", "automatic_data_rollback": False,
                              "details": "Public traffic resumed; retain current data and repair forward.", "backup_directory": str(root)}))
            raise
        if stopped and migrated:
            rollback_db = f"papzii_rollback_{stamp.lower()}"
            restore_clone(frozen, user, rollback_db)
            rollback_url = urlunsplit(parsed._replace(path="/" + rollback_db))
            old_api = {**source_env, "DATABASE_URL": rollback_url}
            old_api.pop("NEON_DATABASE_URL", None)
            old_worker = {**release.environment(worker), "DATABASE_URL": rollback_url}
            old_worker.pop("NEON_DATABASE_URL", None)
            fallback = compose_env(config, old_api, old_worker, api["Config"]["Image"], worker["Config"]["Image"])
            replace_file(compose, json.dumps(fallback, indent=2) + "\n")
            start_services(compose)
            rollback = {"rolled_back_to": rollback_db, "production_database_deleted": False, "backup_directory": str(root)}
            release.private_json(root / "rollback.json", rollback)
            print(json.dumps(rollback))
        elif stopped:
            release.command(["docker", "start", "papzii-api", "papzii-worker-1"])
        replace_file(route_path, route)
        wait_http(public_url + "/health", 200)
        release.command(["docker", "rm", "-f", MAINTENANCE_NAME])
        raise


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rehearsal", required=True)
    parser.add_argument("--compatibility-sql", required=True)
    args = parser.parse_args()
    lock = Path("/var/run/papzii-release.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    promote(args)


if __name__ == "__main__":
    main()
