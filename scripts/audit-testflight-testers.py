"""Inspect existing TestFlight groups without exposing unrelated tester emails."""
import json
import importlib.util
import os
from pathlib import Path
import time

import httpx

module_spec = importlib.util.spec_from_file_location('apple_store_audit', Path(__file__).with_name('audit-apple-store.py'))
apple_store_audit = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(apple_store_audit)
apple_token = apple_store_audit.apple_token


def read(client, path, params=None):
    response = client.get(path, params=params)
    document = response.json()
    data = document.get('data') or []
    if not isinstance(data, list):
        data = [data]
    return response.status_code, data, bool(document.get('links', {}).get('next'))


def audit():
    report = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'readOnly': True, 'appId': '6760396864', 'invitationsSent': False, 'groups': []}
    address = os.environ.get('PAPZI_TESTER_EMAIL', '').strip().casefold()
    if not address:
        report['reason'] = 'set_PAPZI_TESTER_EMAIL_for_the_authorized_named_tester'
        return report
    try:
        with httpx.Client(base_url='https://api.appstoreconnect.apple.com', headers={'Authorization': 'Bearer ' + apple_token(os.environ)}, timeout=30) as client:
            status, groups, more = read(client, '/v1/apps/6760396864/betaGroups', {'limit': 100})
            report.update({'groupsStatus': status, 'moreGroupPages': more})
            for group in groups:
                attrs = group.get('attributes', {})
                state, testers, more_testers = read(client, f"/v1/betaGroups/{group['id']}/betaTesters", {'limit': 200})
                builds_status, builds, more_builds = read(client, f"/v1/betaGroups/{group['id']}/builds", {'limit': 100})
                report['groups'].append({'name': attrs.get('name'), 'internal': attrs.get('isInternalGroup'), 'testersStatus': state,
                                         'countInPage': len(testers), 'moreTesterPages': more_testers,
                                         'buildsStatus': builds_status, 'moreBuildPages': more_builds,
                                         'builds': [{'number': build.get('attributes', {}).get('version'), 'expired': build.get('attributes', {}).get('expired'), 'processingState': build.get('attributes', {}).get('processingState')} for build in builds],
                                         'jonesPresent': any(t.get('attributes', {}).get('email', '').casefold() == address for t in testers)})
            state, testers, _ = read(client, '/v1/betaTesters', {'filter[email]': address, 'limit': 20})
            report['jonesLookup'] = {'status': state, 'count': len(testers)}
    except Exception as error:
        report['reason'] = type(error).__name__
    return report


if __name__ == '__main__':
    report = audit()
    Path('docs/testflight-testers-20261004.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
