"""Restore the encrypted snapshot into an owned isolated database, never production."""
import base64
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import os

spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('backup-offhost-restic.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
SETUP = r'''
import json,re,subprocess
from datetime import datetime,timezone
code="from app.config import get_settings; from urllib.parse import urlparse; import json; u=urlparse(str(get_settings().postgres_url)); print(json.dumps({'database':u.path.lstrip('/'),'user':u.username}))"
meta=json.loads(subprocess.check_output(['docker','exec','papzii-api','python','-c',code],text=True))
assert re.fullmatch(r'[A-Za-z0-9_]+',meta['user'])
target='papzii_offhost_restore_'+datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
assert target!=meta['database'] and re.fullmatch(r'papzii_offhost_restore_[0-9]{14}',target)
result=subprocess.run(['docker','exec','papzii-postgres','createdb','-U',meta['user'],target],capture_output=True)
assert result.returncode==0,'Could not create isolated restore database'
print(json.dumps({'user':meta['user'],'database':target}))
'''
VALIDATE = r'''
import asyncio,asyncpg,json,re,sys
from urllib.parse import urlparse
from app.config import get_settings
from app.main import REQUIRED_SCHEMA_COLUMNS
target=sys.argv[1]
assert re.fullmatch(r'papzii_offhost_restore_[0-9]{14}',target)
async def main():
 url=urlparse(str(get_settings().postgres_url)); assert url.path!='/'+target
 conn=await asyncpg.connect(url._replace(path='/'+target).geturl())
 try:
  rows=await conn.fetch("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'")
  actual={}
  for row in rows: actual.setdefault(row['table_name'],set()).add(row['column_name'])
  missing={table:sorted(set(columns)-actual.get(table,set())) for table,columns in REQUIRED_SCHEMA_COLUMNS.items() if set(columns)-actual.get(table,set())}
  assert not missing,'Restored database schema contract failed'
  users=await conn.fetchval('SELECT count(*) FROM api_users')
  profiles=await conn.fetchval('SELECT count(*) FROM profiles')
  print(json.dumps({'schemaContractPassed':True,'authUserCount':users,'profileCount':profiles}))
 finally: await conn.close()
asyncio.run(main())
'''


def remote(code):
    encoded = base64.b64encode(code.encode()).decode()
    command = 'exec(__import__("base64").b64decode("' + encoded + '"))'
    return json.loads(backup.run([*backup.SSH, 'sudo', '-n', 'python3', '-c', "'" + command + "'"], text=True))


def main():
    report_path = Path('docs/offhost-backup-20261013.json')
    report = json.loads(report_path.read_text())
    snapshot = report['snapshot']
    if not re.fullmatch('[a-f0-9]{64}', snapshot) or not report['retrievedBytesMatch']:
        raise ValueError('Verified encrypted snapshot required')
    restic = shutil.which('restic')
    env = {**os.environ, 'RESTIC_REPOSITORY': str(backup.VAULT / 'repository'),
           'RESTIC_PASSWORD_FILE': str(backup.VAULT / 'repository-password.txt')}
    target = remote(SETUP)
    user, database = target['user'], target['database']
    if not re.fullmatch('[A-Za-z0-9_]+', user) or not re.fullmatch('papzii_offhost_restore_[0-9]{14}', database):
        raise ValueError('Restore scope mismatch')
    try:
        dump = subprocess.Popen([restic, 'dump', snapshot, '/production.dump'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        restore = subprocess.run([*backup.SSH, 'sudo', '-n', 'docker', 'exec', '-i', 'papzii-postgres',
                                  'pg_restore', '-U', user, '--no-owner', '--dbname', database],
                                 stdin=dump.stdout, capture_output=True, timeout=180)
        dump.stdout.close()
        dump.wait(timeout=30)
        if dump.returncode or restore.returncode:
            raise RuntimeError('Isolated PostgreSQL restoration failed; no production database was targeted')
        code = 'exec(__import__("base64").b64decode("' + base64.b64encode(VALIDATE.encode()).decode() + '"))'
        result = json.loads(backup.run([*backup.SSH, 'sudo', '-n', 'docker', 'exec', 'papzii-api',
                                       'python', '-c', "'" + code + "'", database], text=True))
        report.update(result, databaseRestoreFromOffHostTested=True, productionReplaced=False)
    finally:
        # The unique database was created by this invocation and cannot match production.
        backup.run([*backup.SSH, 'sudo', '-n', 'docker', 'exec', 'papzii-postgres', 'dropdb', '-U', user, database], text=True)
    report['isolatedRestoreDatabaseRemoved'] = True
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
