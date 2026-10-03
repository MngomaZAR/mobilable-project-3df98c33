"""Encrypt an existing EAS Apple key for this repository; never log secret values."""
import base64
import json
import subprocess
import sys

import requests
from nacl import encoding, public


def sync(values):
    names = {'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID', 'APPLE_API_KEY_P8_BASE64'}
    if set(values) != names or not all(isinstance(value, str) and value for value in values.values()):
        raise ValueError('Expected only the three existing Apple credential values.')
    process = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, check=True, timeout=20)
    credential = dict(line.split('=', 1) for line in process.stdout.splitlines() if '=' in line)
    session = requests.Session()
    session.headers.update({'Authorization': f"Bearer {credential['password']}", 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10'})
    root = 'https://api.github.com/repos/MngomaZAR/mobilable-project-3df98c33/actions/secrets'
    response = session.get(f'{root}/public-key', timeout=20)
    response.raise_for_status()
    key = response.json()
    box = public.SealedBox(public.PublicKey(key['key'].encode(), encoding.Base64Encoder()))
    statuses = []
    for name in sorted(names):
        # Fail rather than creating redundant credential names or a wrong target.
        session.get(f'{root}/{name}', timeout=20).raise_for_status()
        encrypted = base64.b64encode(box.encrypt(values[name].encode())).decode()
        result = session.put(f'{root}/{name}', json={'encrypted_value': encrypted, 'key_id': key['key_id']}, timeout=20)
        result.raise_for_status()
        statuses.append({'name': name, 'status': result.status_code})
    return statuses


if __name__ == '__main__':
    try:
        result = sync(json.load(sys.stdin))
        print(json.dumps({'updatedExistingSecrets': result}))
    except Exception:
        print(json.dumps({'reason': 'existing_apple_secret_sync_failed'}))
        sys.exit(1)
