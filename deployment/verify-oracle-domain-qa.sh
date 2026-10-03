#!/usr/bin/env bash
# Synthetic data only. This does not migrate or restart production/QA services.
set -euo pipefail
umask 077
archive=$(realpath -e -- "${1:?Pass the candidate source archive}")
root=$(mktemp -d "${HOME:?}/papzii-domain-qa.XXXXXXXX")
run_id=${root##*.}
run_id=${run_id,,}
container="papzii-domain-postgres-qa-$run_id"
image="papzii-api:domain-qa-$run_id"
cleanup() {
    result=$?
    trap - EXIT
    if docker inspect "$container" >/dev/null 2>&1; then
        test "$(docker inspect "$container" --format '{{index .Config.Labels "papzii.qa.domain.run"}}')" = "$run_id" || exit 1
        docker rm -f "$container" >/dev/null || result=1
    fi
    docker image rm "$image" >/dev/null 2>&1 || true
    if [[ "${root%/*}" == "$HOME" && "${root##*/}" =~ ^papzii-domain-qa\.[[:alnum:]]{8}$ && ! -L "$root" ]]; then
        rm -rf -- "$root"
    else
        printf '%s\n' 'Refusing unexpected fixture cleanup.' >&2
        result=1
    fi
    printf '%s\n' 'Owned domain QA container/data removed; existing services were not modified.'
    exit "$result"
}
trap cleanup EXIT
tar -xzf "$archive" -C "$root"
docker build -q -t "$image" -f "$root/backend/api/Dockerfile" "$root"
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
docker run -d --name "$container" --label "papzii.qa.domain.run=$run_id" \
    -p "127.0.0.1:$port:5432" -e POSTGRES_USER=qa -e POSTGRES_PASSWORD=synthetic-qa-only \
    -e POSTGRES_DB=papzii_domain_qa_oracle postgres:16-alpine >/dev/null
ready=false
for attempt in {1..30}; do
    if docker exec "$container" pg_isready -U qa -d papzii_domain_qa_oracle >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
done
test "$ready" = true
docker exec "$container" psql -U qa -d papzii_domain_qa_oracle -v ON_ERROR_STOP=1 \
    -c 'CREATE EXTENSION pgcrypto WITH SCHEMA public' >/dev/null
url="postgresql://qa:synthetic-qa-only@127.0.0.1:$port/papzii_domain_qa_oracle"
docker run --rm --network host -e APP_ENV=qa -e DATABASE_URL="$url" \
    -e PAPZII_DISPATCH_TEST_DATABASE_URL="$url" -e ADMIN_MODERATION_TEST_DATABASE_URL="$url" \
    "$image" python -m unittest tests.test_dispatch_engine tests.test_contracts tests.test_admin_moderation -v
docker run --rm --network host -e APP_ENV=qa -e DATABASE_URL="$url" \
    -e FINANCIAL_PROTOCOL_ALLOW_QA=true "$image" python -m tests.financial_protocol
docker run --rm --network host -e APP_ENV=qa -e DATABASE_URL="$url" \
    -e ACCOUNT_DELETION_PROTOCOL_ALLOW_QA=true "$image" python -m tests.account_deletion_protocol
printf '%s\n' 'Real isolated PostgreSQL domain protocols passed; money/S3 providers in those protocols were mocks.'
