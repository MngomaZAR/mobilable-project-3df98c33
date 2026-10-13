#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" = 0 || { echo 'Run as root on the existing Papzii Oracle host'; exit 1; }
revision=${1:?Full revision required}
api_image=${2:?API digest required}
worker_image=${3:?Worker digest required}
source=${4:?Staged deployment directory required}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "$api_image" =~ ^ghcr.io/mngomazar/papzi-api@sha256:[0-9a-f]{64}$ ]] || exit 1
[[ "$worker_image" =~ ^ghcr.io/mngomazar/papzi-worker@sha256:[0-9a-f]{64}$ ]] || exit 1
[[ "$source" =~ ^/tmp/papzii-candidate-[0-9a-f]{40}-[0-9]+/deployment$ ]] || exit 1
test -f "$source/oracle_release.py" && test -f "$source/oracle_promote.py" || exit 1
test -f /opt/papzii/docker-compose.yml || { echo 'Existing Oracle installation required'; exit 1; }
docker inspect papzii-api papzii-worker-1 papzii-postgres >/dev/null
install -d -m 700 /opt/papzii/releases /var/backups/papzii
destination="/opt/papzii/releases/$revision"
test ! -e "$destination" || { echo 'Candidate staging already exists; inspect previous release first'; exit 1; }
install -d -m 700 "$destination"
cp -R "$source/." "$destination/"
chmod -R go-rwx "$destination"
docker pull "$api_image" >/dev/null
docker pull "$worker_image" >/dev/null
report=$(mktemp /var/backups/papzii/rehearsal-output-XXXXXX.json)
python3 "$destination/oracle_release.py" --revision "$revision" --api-image "$api_image" \
  --worker-image "$worker_image" --compatibility-sql "$destination/sql/preserve_legacy_dispatch.sql" > "$report"
receipt=$(python3 -c 'import json,sys; from pathlib import Path; r=json.load(open(sys.argv[1])); print(Path(r["backup"]).parent / "rehearsal.json")' "$report")
[[ "$receipt" =~ ^/var/backups/papzii/release-[0-9TZ]+/rehearsal.json$ ]] || exit 1
promotion=$(mktemp /var/backups/papzii/promotion-output-XXXXXX.json)
python3 "$destination/oracle_promote.py" --rehearsal "$receipt" \
  --compatibility-sql "$destination/sql/preserve_legacy_dispatch.sql" > "$promotion"
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); assert r["production_replaced"] and r["identities_preserved"] and r["revision"] == sys.argv[2]; print("Oracle promotion verified: " + r["revision"])' "$promotion" "$revision"
configuration=$(mktemp /var/backups/papzii/commission-output-XXXXXX.json)
printf '%s\n' '{"updates":{"COMMISSION_RATE":"0.30"}}' | python3 "$destination/oracle_configure.py" \
  --expected-revision "$revision" > "$configuration"
echo 'Approved 30 percent commission configured in API and worker'
