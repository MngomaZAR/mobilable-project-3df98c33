#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/papzii-s3-qa-20261003
source=/opt/papzii-qa-20261003
test -s "$source/deployment/docker-compose.seaweedfs-qa.yml"
test -s "$source/backend/api/tests/storage_protocol.py"
mkdir -p "$root/artifacts"
if [[ ! -s "$root/fixture.env" ]]; then
    access_key=$(openssl rand -hex 16)
    secret_key=$(openssl rand -hex 32)
    printf 'QA_S3_ACCESS_KEY=%s\nQA_S3_SECRET_KEY=%s\n' "$access_key" "$secret_key" > "$root/fixture.env"
    printf 'APP_ENV=qa\nDATABASE_URL=postgresql://unused/papzii_qa_s3\nMINIO_ENDPOINT=http://storage:8333\nMINIO_ACCESS_KEY=%s\nMINIO_SECRET_KEY=%s\nQA_STORAGE_REPORT_PATH=/artifacts/storage-protocol-report.json\n' "$access_key" "$secret_key" > "$root/protocol.env"
fi
compose=(docker compose --project-name papzii-s3-qa --env-file "$root/fixture.env" -f "$source/deployment/docker-compose.seaweedfs-qa.yml")
"${compose[@]}" config --quiet
"${compose[@]}" up -d
trap '"${compose[@]}" stop >/dev/null 2>&1 || true' EXIT
protocol=(docker run --rm --network papzii-s3-qa_default --env-file "$root/protocol.env" -v "$root/artifacts:/artifacts" -v "$source/backend/api/tests/storage_protocol.py:/app/tests/storage_protocol.py:ro" papzii-api:launch-candidate python -m tests.storage_protocol)
"${protocol[@]}" write
"${compose[@]}" restart storage
"${protocol[@]}" verify
echo 'Isolated S3 protocol passed; production MinIO data/configuration was not changed.'
