"""Manage an explicitly selected beta in existing groups, without public release."""
import argparse
from datetime import datetime, timezone
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

import httpx


APP_ID = '6760396864'
BUNDLE_ID = 'com.papzi.app'
GROUPS = {'Team (Expo)': True, 'papzi': False}
BUILD_NOTES = {'39': (
    'Restricted hosted beta 1.0.0 (39). Test registration, password sign-in and '
    'recovery, profile editing, creator availability/services, discovery, feed, '
    'scheduled booking requests and acceptance, chat, road directions, logout '
    'and retry after disconnection. Report your role, device/OS, screen, steps '
    'and screenshot through TestFlight feedback. Payments, refunds, bank payouts, '
    'video calls, digital purchases and instant dispatch are disabled in this '
    'testing build. Do not enter bank details or attempt real payments. '
    'This is not a public or fully accepted marketplace release.'
), '40': (
    'Restricted hosted beta 1.0.0 (40). Adds scheduled booking acceptance, '
    'notification action retry, native push registration and booking-linked call '
    'entry. Test registration, password sign-in/recovery, profiles, discovery, '
    'feed, scheduled bookings, chat, road directions, notification taps and '
    'network recovery. Report build, role, device/OS, steps and screenshots via '
    'TestFlight feedback. Payments, refunds, bank payouts, video and instant '
    'dispatch remain paused for general use. Only explicitly authorized, '
    'time-limited accounts can participate in separately instructed controlled '
    'acceptance tests. Digital purchasing remains disabled. Do not enter bank '
    'details or attempt real payments without those separate instructions. '
    'This is not a public or fully accepted marketplace release.'
)}


def require_authorized_build(number, report):
    if number not in BUILD_NOTES or report['processingState'] != 'VALID' or report['expired']:
        raise ValueError('An explicitly authorized, validated, unexpired beta build is required')


def apple_token():
    spec = importlib.util.spec_from_file_location('apple_audit', Path(__file__).with_name('audit-apple-store.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.apple_token(os.environ)


class ProviderError(Exception):
    def __init__(self, status, codes):
        self.status, self.codes = status, codes


def request(client, method, path, **kwargs):
    response = client.request(method, path, **kwargs)
    data = response.json() if response.content else {}
    if not response.is_success:
        raise ProviderError(response.status_code, [e.get('code', 'unknown') for e in data.get('errors', [])])
    return data.get('data'), data


def listing(client, path, params=None):
    rows, document = request(client, 'GET', path, params=params)
    if document.get('links', {}).get('next'):
        raise ValueError('Paginated scope requires a separate inventory before mutation')
    return rows or []


def inventory(client, number):
    app, _ = request(client, 'GET', f'/v1/apps/{APP_ID}')
    if app['attributes']['bundleId'] != BUNDLE_ID:
        raise ValueError('App identity mismatch')
    builds = listing(client, '/v1/builds', {'filter[app]': APP_ID, 'filter[version]': number, 'limit': 10})
    if len(builds) != 1:
        raise ValueError('The exact uploaded build is not yet uniquely visible')
    build = builds[0]
    detail, _ = request(client, 'GET', f"/v1/builds/{build['id']}/buildBetaDetail")
    groups = [g for g in listing(client, f'/v1/apps/{APP_ID}/betaGroups', {'limit': 100})
              if g['attributes'].get('name') in GROUPS]
    if len(groups) != len(GROUPS) or any(g['attributes'].get('isInternalGroup') != GROUPS[g['attributes']['name']] for g in groups):
        raise ValueError('Existing beta group identities differ from the authorized scope')
    report = {'appId': APP_ID, 'bundleId': BUNDLE_ID, 'build': number,
              'processingState': build['attributes'].get('processingState'),
              'expired': build['attributes'].get('expired'), 'beta': {
                  key: detail['attributes'].get(key) for key in
                  ('autoNotifyEnabled', 'internalBuildState', 'externalBuildState')}, 'groups': []}
    for group in groups:
        testers = listing(client, f"/v1/betaGroups/{group['id']}/betaTesters", {'limit': 200})
        assigned = listing(client, f"/v1/betaGroups/{group['id']}/builds", {'limit': 100})
        report['groups'].append({'name': group['attributes']['name'],
                                'internal': group['attributes']['isInternalGroup'],
                                'testerCount': len(testers),
                                'buildAssigned': any(b['id'] == build['id'] for b in assigned)})
    review, _ = request(client, 'GET', f'/v1/apps/{APP_ID}/betaAppReviewDetail')
    attrs = review.get('attributes', {}) if review else {}
    report['reviewContactConfigured'] = all(attrs.get(k) for k in ('contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'))
    report['reviewDemoRequired'] = attrs.get('demoAccountRequired')
    report['reviewDemoConfigured'] = bool(attrs.get('demoAccountName') and attrs.get('demoAccountPassword'))
    localizations = listing(client, f'/v1/apps/{APP_ID}/betaAppLocalizations', {'limit': 100})
    report['appDescriptionsConfigured'] = bool(localizations) and all(row['attributes'].get('description') for row in localizations)
    return build, detail, groups, report


def prepare(client, number):
    build, detail, groups, report = inventory(client, number)
    require_authorized_build(number, report)
    notes = listing(client, f"/v1/builds/{build['id']}/betaBuildLocalizations", {'limit': 100})
    english = next((row for row in notes if row['attributes']['locale'] == 'en-GB'), None)
    data = {'type': 'betaBuildLocalizations', 'attributes': {'whatsNew': BUILD_NOTES[number]}}
    if english:
        data['id'] = english['id']
        request(client, 'PATCH', f"/v1/betaBuildLocalizations/{english['id']}", json={'data': data})
    else:
        data['attributes']['locale'] = 'en-GB'
        data['relationships'] = {'build': {'data': {'type': 'builds', 'id': build['id']}}}
        request(client, 'POST', '/v1/betaBuildLocalizations', json={'data': data})
    request(client, 'PATCH', f"/v1/buildBetaDetails/{detail['id']}", json={'data': {
        'type': 'buildBetaDetails', 'id': detail['id'], 'attributes': {'autoNotifyEnabled': True}}})
    for group, state in zip(groups, report['groups']):
        if not state['buildAssigned']:
            request(client, 'POST', f"/v1/builds/{build['id']}/relationships/betaGroups", json={
                'data': [{'type': 'betaGroups', 'id': group['id']}]})
    return inventory(client, number)[3]


def submit_beta_review(client, number):
    build, _, _, report = inventory(client, number)
    require_authorized_build(number, report)
    if not report['reviewContactConfigured'] or not report['appDescriptionsConfigured']:
        raise ValueError('Existing beta review contact or description is incomplete')
    if report['reviewDemoRequired'] and not report['reviewDemoConfigured']:
        raise ValueError('Existing beta reviewer access is incomplete')
    if not all(g['buildAssigned'] for g in report['groups']):
        raise ValueError('Prepare the existing beta groups first')
    if report['reviewDemoRequired'] and not verify_reviewer(client):
        raise ValueError('Existing reviewer credentials do not sign in to the hosted API')
    reviews = listing(client, '/v1/betaAppReviewSubmissions', {'filter[build]': build['id'], 'limit': 20})
    if not reviews:
        review, _ = request(client, 'POST', '/v1/betaAppReviewSubmissions', json={'data': {
            'type': 'betaAppReviewSubmissions', 'relationships': {
                'build': {'data': {'type': 'builds', 'id': build['id']}}}}})
        reviews = [review]
    report['betaReviewStates'] = [row['attributes'].get('betaReviewState') for row in reviews]
    report['publicAppReviewSubmitted'] = False
    return report


def verify_reviewer(client):
    review, _ = request(client, 'GET', f'/v1/apps/{APP_ID}/betaAppReviewDetail')
    attrs = review.get('attributes', {}) if review else {}
    if not attrs.get('demoAccountName') or not attrs.get('demoAccountPassword'):
        return False
    with httpx.Client(base_url='https://papzii-api.129.151.188.15.nip.io', timeout=30) as api:
        response = api.post('/auth/sign-in', json={
            'email': attrs['demoAccountName'], 'password': attrs['demoAccountPassword']})
        if response.status_code != 200:
            return False
        token = (response.json().get('session') or {}).get('access_token')
        if not token:
            return False
        headers = {'Authorization': 'Bearer ' + token}
        try:
            return api.get('/auth/me', headers=headers).status_code == 200
        finally:
            api.post('/auth/sign-out', headers=headers)


def configure_reviewer(client, number):
    report = inventory(client, number)[3]
    require_authorized_build(number, report)
    if verify_reviewer(client):
        report['hostedReviewerSignInVerified'] = True
        return report
    bridge = Path(os.environ.get('PAPZI_REVIEWER_BRIDGE', ''))
    if not bridge.is_file() or not bridge.is_absolute():
        raise ValueError('A protected reviewer-account bridge must be explicitly selected')
    child = subprocess.run([os.environ.get('PAPZI_AUDIT_PYTHON', 'python'), str(bridge)],
                           capture_output=True, text=True, timeout=90)
    if child.returncode:
        raise ValueError('Reviewer account could not be safely configured; private output suppressed')
    credentials = json.loads(child.stdout)
    if credentials.get('name') != 'appreview.beta39@papzii.co.za' or len(credentials.get('password', '')) < 24:
        raise ValueError('Unexpected review-account scope')
    review, _ = request(client, 'GET', f'/v1/apps/{APP_ID}/betaAppReviewDetail')
    request(client, 'PATCH', f"/v1/betaAppReviewDetails/{review['id']}", json={'data': {
        'type': 'betaAppReviewDetails', 'id': review['id'], 'attributes': {
            'demoAccountName': credentials['name'], 'demoAccountPassword': credentials['password'],
            'demoAccountRequired': True, 'notes': BUILD_NOTES[number] + ' Dedicated client-only review account; no administrator or payout permissions.'}}})
    report['hostedReviewerSignInVerified'] = verify_reviewer(client)
    if not report['hostedReviewerSignInVerified']:
        raise ValueError('Updated reviewer sign-in did not pass')
    return report


def email_testers(client, number):
    _, _, groups, report = inventory(client, number)
    require_authorized_build(number, report)
    if not all(g['buildAssigned'] for g in report['groups']):
        raise ValueError('Assign the exact build to existing groups before sending tester mail')
    bridge = Path(os.environ.get('PAPZI_TESTER_MAIL_BRIDGE', ''))
    if not bridge.is_file() or not bridge.is_absolute():
        raise ValueError('A protected tester-mail bridge must be explicitly selected')
    recipients = {}
    for group in groups:
        for tester in listing(client, f"/v1/betaGroups/{group['id']}/betaTesters", {'limit': 200}):
            if tester.get('attributes', {}).get('state') == 'REVOKED':
                continue
            email = (tester.get('attributes', {}).get('email') or '').strip().lower()
            if not email or '\n' in email or '\r' in email:
                raise ValueError('A group tester has no valid email')
            internal = group['attributes']['isInternalGroup']
            recipients[email] = {'email': email, 'internal': internal or recipients.get(email, {}).get('internal', False)}
    if not recipients or len(recipients) > 100:
        raise ValueError('Unexpected tester-mail recipient scope')
    payload = {'appId': APP_ID, 'build': number, 'beta': report['beta'], 'recipients': list(recipients.values())}
    child = subprocess.run([os.environ.get('PAPZI_AUDIT_PYTHON', 'python'), str(bridge)],
                           input=json.dumps(payload), capture_output=True, text=True, timeout=180)
    if child.returncode:
        raise ValueError('Tester mail did not complete; inspect the protected delivery receipt before retrying')
    receipt = json.loads(child.stdout)
    report['email'] = {k: receipt.get(k) for k in ('recipientCount', 'smtpAccepted', 'alreadyAccepted', 'deliveryToInboxVerified', 'externalApprovalPending')}
    return report


def invite_external_testers(client, number):
    _, _, groups, report = inventory(client, number)
    require_authorized_build(number, report)
    if report['beta']['externalBuildState'] != 'IN_BETA_TESTING' or not all(g['buildAssigned'] for g in report['groups']):
        raise ValueError('External build availability must be verified before invitations')
    ledger = Path(os.environ.get('PAPZI_INVITATION_LEDGER', ''))
    if not ledger.is_absolute() or not ledger.is_dir():
        raise ValueError('Select an existing protected invitation ledger outside the repository')
    repository = Path(__file__).resolve().parents[1]
    if ledger.resolve().is_relative_to(repository):
        raise ValueError('Private invitation ledgers must remain outside the repository')
    accepted = already_requested = already_joined = 0
    for group in groups:
        if group['attributes']['isInternalGroup']:
            continue
        for tester in listing(client, f"/v1/betaGroups/{group['id']}/betaTesters", {'limit': 200}):
            if tester['attributes'].get('state') == 'REVOKED':
                continue
            key = hashlib.sha256((APP_ID + ':' + number + ':' + tester['id']).encode()).hexdigest()
            receipt = ledger / (key + '.json')
            if tester['attributes'].get('state') in {'ACCEPTED', 'INSTALLED'}:
                if receipt.exists():
                    receipt.write_text(json.dumps({'state': 'already-joined'}))
                already_joined += 1
                continue
            if receipt.exists():
                previous = json.loads(receipt.read_text())
                if previous.get('state') != 'provider-accepted':
                    raise ValueError('Inspect the earlier ambiguous invitation before retrying')
                already_requested += 1
                continue
            # Reserve intent before POST; a timeout must not cause duplicate email retries.
            with receipt.open('x') as stream:
                json.dump({'state': 'attempting'}, stream)
            try:
                request(client, 'POST', '/v1/betaTesterInvitations', json={'data': {
                    'type': 'betaTesterInvitations', 'relationships': {
                        'app': {'data': {'type': 'apps', 'id': APP_ID}},
                        'betaTester': {'data': {'type': 'betaTesters', 'id': tester['id']}}}}})
            except ProviderError as error:
                if error.status == 409 and error.codes == ['STATE_ERROR.TESTER_INVITE.ALREADY_ACCEPTED']:
                    receipt.write_text(json.dumps({'state': 'already-joined'}))
                    already_joined += 1
                    continue
                raise
            receipt.write_text(json.dumps({'state': 'provider-accepted'}))
            accepted += 1
    report['invitations'] = {'appleAccepted': accepted, 'alreadyRequested': already_requested,
                             'alreadyJoined': already_joined, 'deliveryToInboxVerified': False}
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('inspect', 'prepare', 'beta-review', 'reviewer-check', 'configure-reviewer', 'email-testers', 'invite-external'))
    parser.add_argument('--build', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9]+', args.build):
        parser.error('Use an explicit numeric build number')
    try:
        with httpx.Client(base_url='https://api.appstoreconnect.apple.com',
                          headers={'Authorization': 'Bearer ' + apple_token()}, timeout=30) as client:
            if args.action == 'inspect':
                report = inventory(client, args.build)[3]
            elif args.action == 'prepare':
                report = prepare(client, args.build)
            elif args.action == 'reviewer-check':
                report = inventory(client, args.build)[3]
                report['hostedReviewerSignInVerified'] = verify_reviewer(client)
            elif args.action == 'configure-reviewer':
                report = configure_reviewer(client, args.build)
            elif args.action == 'email-testers':
                report = email_testers(client, args.build)
            elif args.action == 'invite-external':
                report = invite_external_testers(client, args.build)
            else:
                report = submit_beta_review(client, args.build)
        report.update({'checkedAt': datetime.now(timezone.utc).isoformat(), 'action': args.action})
        date = datetime.now(timezone.utc).strftime('%Y%m%d')
        Path(f'docs/testflight-build-{args.build}-{args.action}-{date}.json').write_text(json.dumps(report, indent=2) + '\n', newline='\n')
        print(json.dumps(report))
    except ProviderError as error:
        print(json.dumps({'ok': False, 'status': error.status, 'errorCodes': error.codes}))
        raise SystemExit(1)
    except (ValueError, httpx.HTTPError) as error:
        print(json.dumps({'ok': False, 'reason': str(error) if isinstance(error, ValueError) else type(error).__name__}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
