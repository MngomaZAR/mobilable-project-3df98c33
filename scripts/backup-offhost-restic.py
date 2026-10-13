"""Stream a fresh production dump into a private encrypted off-host repository."""
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess

SSH = ['ssh', '-i', 'C:/Users/27790/.ssh/madabukela_oci', '-o', 'BatchMode=yes',
       '-o', 'StrictHostKeyChecking=yes', 'opc@129.151.188.15']
VAULT = Path('C:/Users/27790/.codex/recovery/papzi-restic-20261013')
SOURCE = r'''
import hashlib,json,os,re,subprocess
from datetime import datetime,timezone
from pathlib import Path
assert os.geteuid()==0
code="from app.config import get_settings; from urllib.parse import urlparse; import json; u=urlparse(str(get_settings().postgres_url)); print(json.dumps({'database':u.path.lstrip('/'),'user':u.username}))"
meta=json.loads(subprocess.check_output(['docker','exec','papzii-api','python','-c',code],text=True))
assert all(re.fullmatch(r'[A-Za-z0-9_]+',meta[k]) for k in ('database','user'))
root=Path('/var/backups/papzii')/('offhost-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
root.mkdir(mode=0o700)
path=root/'production.dump'
with path.open('xb') as stream:
 os.chmod(path,0o600)
 result=subprocess.run(['docker','exec','papzii-postgres','pg_dump','-U',meta['user'],'-Fc',meta['database']],stdout=stream,stderr=subprocess.PIPE)
assert result.returncode==0 and path.stat().st_size>0,'Backup failed; preserve root-only diagnostics'
digest=hashlib.sha256()
with path.open('rb') as stream:
 for block in iter(lambda:stream.read(1024*1024),b''): digest.update(block)
print(json.dumps({'path':str(path),'bytes':path.stat().st_size,'sha256':digest.hexdigest()}))
'''


def run(args, **options):
    result = subprocess.run(args, capture_output=True, **options)
    if result.returncode:
        raise RuntimeError('Protected backup operation failed; no secret output relayed')
    return result.stdout


def main():
    restic = shutil.which('restic')
    if not restic:
        raise ValueError('Install the official restic binary first')
    VAULT.mkdir(parents=True, exist_ok=True)
    identity = run(['whoami'], text=True).strip()
    run(['icacls', str(VAULT), '/inheritance:r', '/grant:r', f'{identity}:(OI)(CI)F', 'SYSTEM:(OI)(CI)F'], text=True)
    password = VAULT / 'repository-password.txt'
    if not password.exists():
        with password.open('x') as stream:
            stream.write(secrets.token_urlsafe(48))
    repository = VAULT / 'repository'
    env = {**os.environ, 'RESTIC_REPOSITORY': str(repository), 'RESTIC_PASSWORD_FILE': str(password)}
    if not (repository / 'config').exists():
        run([restic, 'init'], env=env, text=True)
    code = 'exec(__import__("base64").b64decode("' + base64.b64encode(SOURCE.encode()).decode() + '"))'
    source = json.loads(run([*SSH, 'sudo', '-n', 'python3', '-c', "'" + code + "'"], text=True))
    path = source['path']
    if not path.startswith('/var/backups/papzii/offhost-') or not path.endswith('/production.dump') or any(c in path for c in " '\n\r;"):
        raise ValueError('Unexpected protected backup source')
    transport = subprocess.Popen([*SSH, 'sudo', '-n', 'cat', path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    backup = subprocess.run([restic, 'backup', '--stdin', '--stdin-filename', 'production.dump',
                             '--host', 'papzi-prod-a1', '--tag', 'production-db', '--json'],
                            stdin=transport.stdout, capture_output=True, env=env, timeout=300)
    transport.stdout.close()
    transport.wait(timeout=30)
    if transport.returncode or backup.returncode:
        raise RuntimeError('Off-host snapshot failed; original protected server backup is preserved')
    summary = next(json.loads(line) for line in backup.stdout.decode().splitlines()
                   if json.loads(line).get('message_type') == 'summary')
    snapshot = summary['snapshot_id']
    run([restic, 'check', '--read-data'], env=env, text=True, timeout=300)
    restored = subprocess.Popen([restic, 'dump', snapshot, '/production.dump'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    digest = hashlib.sha256()
    size = 0
    for block in iter(lambda: restored.stdout.read(1024 * 1024), b''):
        digest.update(block)
        size += len(block)
    restored.stdout.close()
    restored.wait(timeout=30)
    if restored.returncode or size != source['bytes'] or digest.hexdigest() != source['sha256']:
        raise RuntimeError('Encrypted backup retrieval did not match the original')
    report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'tool': 'restic', 'snapshot': snapshot,
              'encryptedOffHostCopy': True, 'repositoryCheckPassed': True, 'retrievedBytesMatch': True,
              'bytes': size, 'sha256': digest.hexdigest(), 'plaintextLocalDumpWritten': False,
              'productionReplaced': False, 'databaseRestoreFromOffHostTested': False,
              'scheduledRemoteStorageConfigured': False}
    Path('docs/offhost-backup-20261013.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
