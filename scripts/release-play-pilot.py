"""Promote the explicitly authorized version 5 on the existing internal track only."""
import argparse
import copy
import json
import time
from pathlib import Path

from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

PACKAGE = 'com.papziiii.paparazzi'
VERSION = '5'


def pilot_release(track):
    if track.get('track') != 'internal':
        raise ValueError('Internal track required')
    matches = [r for r in track.get('releases', []) if r.get('versionCodes') == [VERSION]]
    if len(matches) != 1 or matches[0].get('status') not in ('draft', 'completed'):
        raise ValueError('Exact uploaded pilot version required')
    if any(int(v) > int(VERSION) for r in track.get('releases', []) for v in r.get('versionCodes', [])):
        raise ValueError('A newer release exists; do not downgrade')
    release = copy.deepcopy(matches[0])
    release['status'] = 'completed'
    release.pop('userFraction', None)
    return {'track': 'internal', 'releases': [release]}


def checked(response):
    if not response.ok:
        raise RuntimeError(f'Publisher operation refused: HTTP {response.status_code}')
    return response.json() if response.content else {}


def run(key):
    credentials = service_account.Credentials.from_service_account_file(key, scopes=[
        'https://www.googleapis.com/auth/androidpublisher'])
    if credentials.project_id != 'papz-601b5':
        raise ValueError('Existing Papzi publisher identity required')
    receipt = json.loads(Path('docs/store-history-20261013.json').read_text())
    builds = [b for b in receipt['builds'] if b['id'] == '0d1e6ff9-caa5-4b2d-ae9b-9cb2a70d618e']
    if len(builds) != 1 or builds[0]['status'] != 'FINISHED' or builds[0]['buildProfile'] != 'beta-testing' or builds[0]['gitCommitHash'] != 'ae6657699771fa7ff025c7b329026c6859d6ae37':
        raise ValueError('Verified exact restricted-test build receipt required')
    root = f'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}/edits'
    report = {'package': PACKAGE, 'versionCode': VERSION, 'track': 'internal',
              'publicReleasePerformed': False, 'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    with AuthorizedSession(credentials) as session:
        edit = checked(session.post(root, json={}, timeout=30))['id']
        committed = False
        try:
            tracks = checked(session.get(f'{root}/{edit}/tracks', timeout=30))['tracks']
            track = next(t for t in tracks if t['track'] == 'internal')
            payload = pilot_release(track)
            report['previousInternalReleases'] = [{'versionCodes': r.get('versionCodes'), 'status': r.get('status')} for r in track['releases']]
            if track['releases'] == payload['releases']:
                report['alreadyReleased'] = True
                return report
            updated = checked(session.put(f'{root}/{edit}/tracks/internal', json=payload, timeout=30))
            if updated.get('track') != 'internal' or updated.get('releases') != payload['releases']:
                raise ValueError('Publisher update differs from requested pilot')
            checked(session.post(f'{root}/{edit}:validate', timeout=30))
            report['commitAttempted'] = True
            Path('docs/play-pilot-release-20261013.json').write_text(json.dumps(report, indent=2) + '\n')
            checked(session.post(f'{root}/{edit}:commit', params={'changesNotSentForReview': 'false'}, timeout=60))
            committed = True
            report['commitAccepted'] = True
            report['releaseStatus'] = 'completed'
            return report
        finally:
            if not committed:
                session.delete(f'{root}/{edit}', timeout=30)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--key-file', required=True)
    args = parser.parse_args()
    try:
        report = run(args.key_file)
    except Exception as exc:
        report = {'publicReleasePerformed': False, 'internalReleaseVerified': False,
                  'reason': str(exc) if isinstance(exc, (ValueError, RuntimeError)) else 'Inspect publisher state before retrying'}
    Path('docs/play-pilot-release-20261013.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    raise SystemExit(0 if report.get('commitAccepted') or report.get('alreadyReleased') else 1)
