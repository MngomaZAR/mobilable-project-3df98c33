"""Check existing Play tracks; discard every temporary edit without committing."""
import argparse
import json
import time
from pathlib import Path

from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession


def response_status(response):
    result = {'status': response.status_code}
    if not response.ok:
        try:
            error = response.json().get('error', {})
            result['errorStatus'] = error.get('status')
            result['reasons'] = [item['reason'] for item in error.get('errors', []) if item.get('reason')]
            result['detailReasons'] = [item['reason'] for item in error.get('details', []) if item.get('reason')]
        except ValueError:
            result['reason'] = 'non_json_provider_error'
    return result


def audit(key_path, enable_api=False):
    credentials = service_account.Credentials.from_service_account_file(key_path, scopes=[
        'https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/androidpublisher',
    ])
    if credentials.project_id != 'papz-601b5':
        raise ValueError('Only the existing Papzi publisher project is allowed.')
    session = AuthorizedSession(credentials)
    report = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'projectId': credentials.project_id,
              'credentialFile': Path(key_path).name, 'publishingPerformed': False, 'packages': []}
    service_url = f'https://serviceusage.googleapis.com/v1/projects/{credentials.project_id}/services/androidpublisher.googleapis.com'
    response = session.get(service_url, timeout=30)
    report['publisherApi'] = response_status(response)
    if response.ok:
        report['publisherApi']['state'] = response.json().get('state')
        if enable_api and response.json().get('state') == 'DISABLED':
            enabled = session.post(service_url + ':enable', json={}, timeout=60)
            report['enablePublisherApi'] = response_status(enabled)
            if enabled.ok:
                operation = enabled.json().get('name', '')
                if operation.startswith('operations/'):
                    for _ in range(6):
                        time.sleep(5)
                        state = session.get(f'https://serviceusage.googleapis.com/v1/{operation}', timeout=20)
                        if state.ok and state.json().get('done'):
                            break
                response = session.get(service_url, timeout=30)
                report['publisherApiAfterEnable'] = {**response_status(response), 'state': response.json().get('state') if response.ok else None}
    for package in ('com.papziiii.paparazzi', 'com.saicts.papzi', 'com.papzi.app'):
        root = f'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{package}/edits'
        edit_id = None
        record = {'packageName': package}
        try:
            edit = session.post(root, json={}, timeout=30)
            record['access'] = response_status(edit)
            if not edit.ok:
                report['packages'].append(record)
                continue
            edit_id = edit.json()['id']
            tracks = session.get(f'{root}/{edit_id}/tracks', timeout=30)
            record['trackLookup'] = response_status(tracks)
            if tracks.ok:
                record['tracks'] = [{'track': track.get('track'), 'releases': [
                    {'versionCodes': release.get('versionCodes'), 'status': release.get('status')}
                    for release in track.get('releases', [])
                ]} for track in tracks.json().get('tracks', [])]
        finally:
            if edit_id:
                discarded = session.delete(f'{root}/{edit_id}', timeout=30)
                record['temporaryEditDiscarded'] = discarded.status_code == 204
        report['packages'].append(record)
    session.close()
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--key-file', required=True)
    parser.add_argument('--enable-publisher-api', action='store_true')
    arguments = parser.parse_args()
    try:
        result = audit(arguments.key_file, arguments.enable_publisher_api)
    except Exception:
        result = {'publishingPerformed': False, 'reason': 'publisher_account_check_failed'}
    destination = Path('docs/play-publisher-status-20261004.json')
    destination.write_text(json.dumps(result, indent=2) + '\n', newline='\n')
    print(json.dumps(result, indent=2))
