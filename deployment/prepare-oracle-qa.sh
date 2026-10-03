#!/usr/bin/env bash
set -euo pipefail
umask 077

root=/opt/papzii-qa-20261003
test -d "$root/backend/api" || { echo 'Candidate source directory is missing'; exit 1; }
test "$(curl -fsS -H 'Authorization: Bearer Oracle' http://169.254.169.254/opc/v2/instance/ | python3 -c 'import sys,json; print(json.load(sys.stdin)["compartmentId"])')" = 'ocid1.tenancy.oc1..aaaaaaaabs56xuwbrgbc6almcvkshzkmb4arpw5rytwglbumfobw3bjsbuba'

docker inspect papzii-api | python3 -c '
import json,sys
from urllib.parse import urlsplit,urlunsplit
env=dict(item.split("=",1) for item in json.load(sys.stdin)[0]["Config"]["Env"] if "=" in item)
url=urlsplit(env["DATABASE_URL"])
env["DATABASE_URL"]=urlunsplit((url.scheme,url.netloc,"/papzii_qa_20261003",url.query,url.fragment))
env["APP_ENV"]="qa"
env["ALLOW_RUNTIME_SCHEMA_CHANGES"]="false"
env["ADMIN_USER_IDS"]="qa-admin-20261003"
env["API_PUBLIC_URL"]="https://papzii-qa.129.151.188.15.nip.io"
for key in ("PAYFAST_MERCHANT_ID","PAYFAST_MERCHANT_KEY","PAYFAST_PASSPHRASE","EXPO_ACCESS_TOKEN",
            "SMTP_HOST","SMTP_USER","SMTP_PASSWORD","SMTP_FROM","RECOVERY_ENCRYPTION_KEY",
            "LIVEKIT_URL","LIVEKIT_API_KEY","LIVEKIT_API_SECRET"):
    env[key]=""
for key,value in env.items():
    if "\n" in value: raise ValueError("Multiline container environment unsupported")
    print(key+"="+value)
' > "$root/qa.env"

database_user=$(docker exec papzii-postgres printenv POSTGRES_USER)
if ! docker exec papzii-postgres psql -U "$database_user" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='papzii_qa_20261003'" | grep -qx 1; then
    docker exec papzii-postgres createdb -U "$database_user" papzii_qa_20261003
fi
docker build -t papzii-api:launch-candidate -f "$root/backend/api/Dockerfile" "$root"
docker run --rm --network papzii_default --env-file "$root/qa.env" papzii-api:launch-candidate python -m app.migrate
docker run --rm --network papzii_default --env-file "$root/qa.env" papzii-api:launch-candidate python -m unittest discover -s tests -p test_security.py -v
if docker container inspect papzii-api-qa >/dev/null 2>&1; then
    echo 'Existing QA container found; stop and replace it explicitly after reviewing its status.'
    exit 1
fi
docker run -d --name papzii-api-qa --network papzii_default --env-file "$root/qa.env" -p 127.0.0.1:18000:8000 --restart unless-stopped papzii-api:launch-candidate
for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:18000/health >/dev/null; then break; fi
    sleep 2
done
mkdir -p "$root/artifacts"
docker run --rm --network papzii_default --env-file "$root/qa.env" -v "$root/artifacts:/artifacts" papzii-api:launch-candidate python -m tests.role_load
