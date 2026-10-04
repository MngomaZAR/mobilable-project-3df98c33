"""Read existing Apple records without building, submitting or publishing an app."""
import base64
import json
import os
import time
from pathlib import Path

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


def apple_token(environ):
    key_id = environ.get('APPLE_API_KEY_ID', '')
    issuer = environ.get('APPLE_API_ISSUER_ID', '')
    encoded = environ.get('APPLE_API_KEY_P8_BASE64', '')
    if not all((key_id, issuer, encoded)):
        raise ValueError('missing_apple_api_credentials')
    key = serialization.load_pem_private_key(base64.b64decode(encoded, validate=True), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey) or key.curve.name != 'secp256r1':
        raise ValueError('invalid_apple_key_type')
    now = int(time.time())
    header = b64(json.dumps({'alg': 'ES256', 'kid': key_id, 'typ': 'JWT'}).encode())
    body = b64(json.dumps({'iss': issuer, 'iat': now - 10, 'exp': now + 300, 'aud': 'appstoreconnect-v1'}).encode())
    message = f'{header}.{body}'
    r, s = decode_dss_signature(key.sign(message.encode(), ec.ECDSA(hashes.SHA256())))
    return f'{message}.{b64(r.to_bytes(32, "big") + s.to_bytes(32, "big"))}'


SAFE_ATTRIBUTES = {
    'name', 'bundleId', 'version', 'uploadedDate', 'expirationDate', 'expired',
    'processingState', 'versionString', 'platform', 'appStoreState', 'appVersionState',
    'internalBuildState', 'externalBuildState', 'betaReviewState', 'submittedDate',
    'isInternalGroup', 'hasAccessToAllBuilds', 'publicLinkEnabled',
}


def resources(document):
    # No response links, tester emails, reviewer credentials or signed assets.
    result = []
    for row in document.get('data', []) + document.get('included', []):
        item = {'id': row['id'], 'type': row['type'], 'attributes': {
            key: value for key, value in row.get('attributes', {}).items() if key in SAFE_ATTRIBUTES
        }}
        relationships = {}
        for key in ('app', 'build', 'preReleaseVersion', 'buildBetaDetail', 'betaGroups'):
            linked = row.get('relationships', {}).get(key, {}).get('data')
            if linked:
                relationships[key] = linked
        if relationships:
            item['relationships'] = relationships
        result.append(item)
    return result


def query(client, path, params=None):
    try:
        response = client.get(path, params=params)
        document = response.json()
        if response.is_success:
            return {'status': response.status_code, 'resources': resources(document)}
        return {'status': response.status_code, 'errorCodes': [str(error.get('code', 'unknown'))[:100] for error in document.get('errors', [])]}
    except (httpx.HTTPError, ValueError):
        return {'reason': 'provider_request_failed'}


def audit():
    report = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'readOnly': True, 'apps': []}
    try:
        token = apple_token(os.environ)
    except Exception:
        report['reason'] = 'apple_api_credentials_missing_or_invalid'
        return report
    with httpx.Client(base_url='https://api.appstoreconnect.apple.com', headers={'Authorization': f'Bearer {token}'}, timeout=30, follow_redirects=False) as client:
        for bundle in ('com.papzi.app', 'com.saicts.papzi'):
            apps = query(client, '/v1/apps', {'filter[bundleId]': bundle, 'limit': 10})
            record = {'bundleIdentifier': bundle, 'appLookup': apps}
            for app in apps.get('resources', []):
                if app['type'] != 'apps':
                    continue
                app_id = app['id']
                record['builds'] = query(client, '/v1/builds', {'filter[app]': app_id, 'sort': '-uploadedDate', 'limit': 25, 'include': 'preReleaseVersion,buildBetaDetail'})
                record['storeVersions'] = query(client, f'/v1/apps/{app_id}/appStoreVersions', {'limit': 20})
                record['betaGroups'] = query(client, f'/v1/apps/{app_id}/betaGroups', {'limit': 25})
                latest = [item['id'] for item in record['builds'].get('resources', []) if item['type'] == 'builds'][:5]
                if latest:
                    record['betaReviews'] = query(client, '/v1/betaAppReviewSubmissions', {'filter[build]': ','.join(latest), 'limit': 20})
            report['apps'].append(record)
    return report


if __name__ == '__main__':
    result = audit()
    destination = Path(os.environ.get('STORE_AUDIT_OUTPUT', 'docs/apple-store-status-20261003.json'))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'report': str(destination), 'readOnly': True, 'reason': result.get('reason'), 'apps': [
        {'bundleIdentifier': app['bundleIdentifier'], 'lookupStatus': app['appLookup'].get('status'),
         'apps': app['appLookup'].get('resources', []), 'storeVersions': app.get('storeVersions', {}),
         'builds': [row for row in app.get('builds', {}).get('resources', []) if row['type'] in ('builds', 'buildBetaDetails')][:8]}
        for app in result['apps']
    ]}, indent=2))
