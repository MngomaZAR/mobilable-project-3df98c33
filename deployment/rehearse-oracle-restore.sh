#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" -eq 0
root=/opt/papzii-qa-20261003
test -s "$root/qa.env"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir=/var/backups/papzii
install -d -m 700 "$backup_dir"
backup="$backup_dir/production-$stamp.dump"
restore_db="papzii_qa_restore_$stamp"
docker inspect papzii-api | python3 -c 'import json,sys; from urllib.parse import urlsplit; c=json.load(sys.stdin)[0]; env=dict(e.split("=",1) for e in c["Config"]["Env"]); url=env.get("NEON_DATABASE_URL") or env["DATABASE_URL"]; p=urlsplit(url); assert p.hostname in {"postgres","papzii-postgres"}, "Expected local production database"; assert "_qa_" not in p.path; print(p.path.lstrip("/"))' > "$backup_dir/source-db-$stamp.txt"
source_db=$(cat "$backup_dir/source-db-$stamp.txt")
pg_user=$(docker inspect papzii-postgres | python3 -c 'import json,sys; e=dict(x.split("=",1) for x in json.load(sys.stdin)[0]["Config"]["Env"]); print(e.get("POSTGRES_USER","postgres"))')
docker exec papzii-postgres pg_dump -U "$pg_user" -Fc "$source_db" > "$backup"
test -s "$backup"
sha256sum "$backup" > "$backup.sha256"
docker exec papzii-postgres createdb -U "$pg_user" "$restore_db"
docker exec -i papzii-postgres pg_restore -U "$pg_user" -d "$restore_db" --no-owner --exit-on-error < "$backup"
python3 - "$root/qa.env" "$root/restore.env" "$restore_db" <<'PY'
import pathlib,sys
from urllib.parse import urlsplit,urlunsplit
source,destination,database=sys.argv[1:]
env={line.split('=',1)[0]:line.split('=',1)[1] for line in pathlib.Path(source).read_text().splitlines() if '=' in line and not line.startswith('#')}
p=urlsplit(env['DATABASE_URL'])
env['DATABASE_URL']=urlunsplit(p._replace(path='/'+database))
env['APP_ENV']='qa-restore'
env.pop('NEON_DATABASE_URL',None)
pathlib.Path(destination).write_text('\n'.join(f'{k}={v}' for k,v in env.items())+'\n')
PY
chmod 600 "$root/restore.env"
docker run --rm --network papzii_default --env-file "$root/restore.env" papzii-api:launch-candidate python -m app.migrate
docker run --rm --network papzii_default --env-file "$root/restore.env" papzii-api:launch-candidate python -c 'import asyncio,json; from app.config import get_settings; from app.main import REQUIRED_SCHEMA_COLUMNS; from app.database import schema_contract_status; r=asyncio.run(schema_contract_status(get_settings(),REQUIRED_SCHEMA_COLUMNS)); print(json.dumps(r)); assert r["ok"]'
printf 'Restore and migrations verified. Root-only backup: %s\nRestored database: %s\n' "$backup" "$restore_db"
