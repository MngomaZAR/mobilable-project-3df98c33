#!/usr/bin/env bash
set -euo pipefail
export PYTHONPATH="$PWD/backend/api:$PWD/backend"
python -m app.migrate
python -m unittest discover -s backend/api/tests -p 'test_*.py' -v
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
