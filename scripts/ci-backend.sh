#!/usr/bin/env bash
set -euo pipefail
export PYTHONPATH="$PWD/backend/api:$PWD/backend"
python -m app.migrate
python -m unittest discover -s backend/api/tests -p 'test_*.py' -v
python -m tests.auth_protocol
docker run -d --name papzi-ci-minio -p 19000:9000 \
    -e MINIO_ROOT_USER="$MINIO_ACCESS_KEY" -e MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \
    quay.io/minio/minio:latest server /data
python -m uvicorn app.main:app --host 127.0.0.1 --port 18000 --workers 2 --timeout-keep-alive 30 > "$RUNNER_TEMP/papzi-api.log" 2>&1 &
api_pid=$!
PYTHONPATH="$PWD/backend/worker:$PWD/backend" python -m app.main > "$RUNNER_TEMP/papzi-worker.log" 2>&1 &
worker_pid=$!
trap 'kill "$api_pid" "$worker_pid" 2>/dev/null || true; docker stop papzi-ci-minio >/dev/null 2>&1 || true' EXIT
for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:18000/health >/dev/null && curl -fsS http://127.0.0.1:19000/minio/health/live >/dev/null; then break; fi
    sleep 2
done
python -m tests.role_load
python -m tests.payment_protocol
