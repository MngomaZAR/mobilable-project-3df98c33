#!/usr/bin/env bash
set -euo pipefail
export PYTHONPATH="$PWD/backend/api:$PWD/backend"
python -m app.migrate
python - <<'PY'
import asyncio, os
from urllib.parse import urlsplit
import asyncpg
async def prepare():
    url = os.environ['DATABASE_URL']
    parsed = urlsplit(url)
    if parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.path != '/papzii_qa_ci' or os.environ.get('APP_ENV') != 'qa':
        raise RuntimeError('Refusing to create protocol fixtures outside the isolated CI database.')
    conn = await asyncpg.connect(url)
    try:
        await conn.execute('CREATE DATABASE papzii_protocol_qa_ci')
    finally:
        await conn.close()
    conn = await asyncpg.connect(url.rsplit('/', 1)[0] + '/papzii_protocol_qa_ci')
    try:
        await conn.execute('CREATE EXTENSION pgcrypto WITH SCHEMA public')
    finally:
        await conn.close()
asyncio.run(prepare())
PY
export PAPZII_DISPATCH_TEST_DATABASE_URL="${DATABASE_URL%/*}/papzii_protocol_qa_ci"
export ADMIN_MODERATION_TEST_DATABASE_URL="$DATABASE_URL"
python -m unittest discover -s backend/api/tests -p 'test_*.py' -v
PYTHONPATH="$PWD/backend/worker:$PWD/backend" python -m unittest discover -s backend/worker/tests -p 'test_*.py' -v
DATABASE_URL="$PAPZII_DISPATCH_TEST_DATABASE_URL" FINANCIAL_PROTOCOL_ALLOW_QA=true python -m tests.financial_protocol
DATABASE_URL="$PAPZII_DISPATCH_TEST_DATABASE_URL" ACCOUNT_DELETION_PROTOCOL_ALLOW_QA=true python -m tests.account_deletion_protocol
python -m tests.auth_protocol
docker run -d --name papzi-ci-storage -p 127.0.0.1:19000:8333 \
    -e AWS_ACCESS_KEY_ID="$MINIO_ACCESS_KEY" -e AWS_SECRET_ACCESS_KEY="$MINIO_SECRET_KEY" \
    chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d \
    mini -dir=/data -admin.ui=false -webdav=false -s3.port.iceberg=0 -s3.port.lance=0 \
    -s3.allowDeleteBucketNotEmpty=false -master.telemetry=false -volume.max=4
trap 'docker stop papzi-ci-storage >/dev/null 2>&1 || true' EXIT
python -m tests.storage_protocol write
docker restart papzi-ci-storage
python -m tests.storage_protocol verify
python -m uvicorn app.main:app --host 127.0.0.1 --port 18000 --workers 2 --timeout-keep-alive 30 > "$RUNNER_TEMP/papzi-api.log" 2>&1 &
api_pid=$!
PYTHONPATH="$PWD/backend/worker:$PWD/backend" python -m app.main > "$RUNNER_TEMP/papzi-worker.log" 2>&1 &
worker_pid=$!
trap 'kill "$api_pid" "$worker_pid" 2>/dev/null || true; docker stop papzi-ci-storage >/dev/null 2>&1 || true' EXIT
for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:18000/health >/dev/null; then break; fi
    sleep 2
done
python -m tests.role_load
python -m tests.payment_protocol
