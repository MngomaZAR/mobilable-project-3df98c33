#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/papzii-qa-20261003
api_image=papzii-api:launch-candidate
worker_image=papzii-worker:launch-candidate
artifact_dir="$root/artifacts"
test -s "$root/qa.env"
grep -Eq '^DATABASE_URL=.*[/]papzii_qa_20261003([?].*)?$' "$root/qa.env"
# NEON_DATABASE_URL takes precedence in Settings; it must not redirect QA writes.
if grep -Eq '^NEON_DATABASE_URL=.+' "$root/qa.env"; then
    grep -Eq '^NEON_DATABASE_URL=.*[/]papzii_qa_20261003([?].*)?$' "$root/qa.env"
fi
if [[ "${1:-}" == '--check-only' ]]; then
    exit 0
fi
# Signed QA media must be reachable through the same private SSH tunnel as the API.
# This value is never copied into production or used by native release builds.
sed -i '/^API_PUBLIC_URL=/d' "$root/qa.env"
printf '%s\n' 'API_PUBLIC_URL=http://127.0.0.1:18000' >> "$root/qa.env"
if docker inspect papzii-osrm >/dev/null 2>&1; then
    sed -i '/^OSRM_BASE_URL=/d' "$root/qa.env"
    printf '%s\n' 'OSRM_BASE_URL=http://papzii-osrm:5000' >> "$root/qa.env"
fi
if [[ "${1:-}" == '--pull-images' ]]; then
    api_image=${QA_API_IMAGE:?Set the immutable QA API image digest}
    worker_image=${QA_WORKER_IMAGE:?Set the immutable QA worker image digest}
    revision=${QA_SOURCE_REVISION:?Set the full tested source revision}
    [[ "$api_image" =~ ^ghcr.io/mngomazar/papzi-api@sha256:[a-f0-9]{64}$ ]]
    [[ "$worker_image" =~ ^ghcr.io/mngomazar/papzi-worker@sha256:[a-f0-9]{64}$ ]]
    [[ "$revision" =~ ^[a-f0-9]{40}$ ]]
    for image in "$api_image" "$worker_image"; do
        docker pull "$image"
        test "$(docker inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$revision"
    done
    artifact_dir="$root/artifacts/ghcr-$revision"
    mkdir -p "$artifact_dir"
else
    tar -xzf /home/opc/papzii-qa-candidate.tgz -C "$root"
    docker build -t "$api_image" -f "$root/backend/api/Dockerfile" "$root"
    docker build -t "$worker_image" -f "$root/backend/worker/Dockerfile" "$root"
fi
docker run --rm --network papzii_default --env-file "$root/qa.env" "$api_image" python -m app.migrate
docker run --rm --network papzii_default --env-file "$root/qa.env" "$api_image" python -m unittest discover -s tests -p 'test_*.py' -v
if [[ "${1:-}" == '--build-only' ]]; then
    exit 0
fi
for name in papzii-api-qa papzii-worker-qa; do
    if docker inspect "$name" >/dev/null 2>&1; then
        docker inspect "$name" | python3 -c 'import json,sys; c=json.load(sys.stdin)[0]; assert any("/papzii_qa_20261003" in e for e in c["Config"]["Env"] if e.startswith("DATABASE_URL=")), "Not a QA database"'
        docker stop "$name"
        docker rm "$name"
    fi
done
docker run -d --name papzii-api-qa --network papzii_default --env-file "$root/qa.env" -p 127.0.0.1:18000:8000 --restart unless-stopped "$api_image"
docker run --rm --network papzii_default --env-file "$root/qa.env" -v "$artifact_dir:/artifacts" "$api_image" python -m tests.auth_protocol
docker run -d --name papzii-worker-qa --network papzii_default --env-file "$root/qa.env" --restart unless-stopped "$worker_image"
for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:18000/health >/dev/null; then break; fi
    sleep 2
done
docker run --rm --network papzii_default --env-file "$root/qa.env" -v "$artifact_dir:/artifacts" "$api_image" python -m tests.role_load
docker run --rm --network papzii_default --env-file "$root/qa.env" -v "$artifact_dir:/artifacts" "$api_image" python -m tests.payment_protocol
