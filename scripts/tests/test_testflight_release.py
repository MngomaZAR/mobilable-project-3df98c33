"""Safety checks for authorized TestFlight management; no provider calls."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('testflight', Path(__file__).parents[1] / 'manage-testflight-release.py')
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class TestFlightScopeTests(unittest.TestCase):
    def state(self):
        build = {'id': 'authorized-build', 'attributes': {'processingState': 'VALID', 'expired': False}}
        report = {'processingState': 'VALID', 'expired': False, 'reviewContactConfigured': True,
                  'appDescriptionsConfigured': True, 'reviewDemoRequired': True,
                  'reviewDemoConfigured': True, 'groups': [{'buildAssigned': True}]}
        return build, {}, [], report

    def test_processing_or_other_build_cannot_be_prepared(self):
        for number, processing in [('38', 'VALID'), ('42', 'VALID'), ('39', 'PROCESSING'), ('40', 'PROCESSING'), ('41', 'PROCESSING')]:
            state = self.state()
            state[0]['attributes']['processingState'] = processing
            state[3]['processingState'] = processing
            with patch.object(release, 'inventory', return_value=state), patch.object(release, 'request') as request:
                with self.assertRaises(ValueError):
                    release.prepare(None, number)
                request.assert_not_called()

    def test_review_requires_actual_hosted_reviewer_access(self):
        with patch.object(release, 'inventory', return_value=self.state()), patch.object(release, 'verify_reviewer', return_value=False), patch.object(release, 'request') as request:
            with self.assertRaises(ValueError):
                release.submit_beta_review(None, '39')
            request.assert_not_called()

    def test_missing_description_cannot_submit_review(self):
        state = self.state()
        state[3]['appDescriptionsConfigured'] = False
        with patch.object(release, 'inventory', return_value=state), patch.object(release, 'request') as request:
            with self.assertRaises(ValueError):
                release.submit_beta_review(None, '39')
            request.assert_not_called()

    def test_existing_review_is_not_duplicated(self):
        with patch.object(release, 'inventory', return_value=self.state()), patch.object(release, 'verify_reviewer', return_value=True), patch.object(release, 'listing', return_value=[{'attributes': {'betaReviewState': 'WAITING_FOR_REVIEW'}}]), patch.object(release, 'request') as request:
            report = release.submit_beta_review(None, '39')
            self.assertEqual(report['betaReviewStates'], ['WAITING_FOR_REVIEW'])
            self.assertFalse(report['publicAppReviewSubmitted'])
            request.assert_not_called()

    def test_paginated_scope_fails_before_mutation(self):
        with patch.object(release, 'request', return_value=([], {'links': {'next': 'another-page'}})):
            with self.assertRaises(ValueError):
                release.listing(None, '/existing-group')

    def test_notes_do_not_claim_financial_acceptance(self):
        for notes in release.BUILD_NOTES.values():
            self.assertIn('disabled', notes)
            self.assertIn('Do not enter bank details', notes)
        self.assertIn('paused for general use', release.BUILD_NOTES['40'])
        self.assertIn('time-limited accounts', release.BUILD_NOTES['40'])

    def test_new_build_must_be_valid_and_unexpired(self):
        report = self.state()[3]
        release.require_authorized_build('41', report)
        report['expired'] = True
        with self.assertRaises(ValueError):
            release.require_authorized_build('41', report)

    def test_new_build_review_is_beta_only(self):
        with patch.object(release, 'inventory', return_value=self.state()), patch.object(release, 'verify_reviewer', return_value=True), patch.object(release, 'listing', return_value=[]), patch.object(release, 'request', return_value=({'attributes': {'betaReviewState': 'WAITING_FOR_REVIEW'}}, {})) as request:
            report = release.submit_beta_review(None, '40')
            self.assertFalse(report['publicAppReviewSubmitted'])
            self.assertEqual(request.call_args.args[2], '/v1/betaAppReviewSubmissions')

    def test_unavailable_external_build_cannot_invite(self):
        state = self.state()
        state[3]['beta'] = {'externalBuildState': 'WAITING_FOR_BETA_REVIEW'}
        with patch.object(release, 'inventory', return_value=state), patch.object(release, 'request') as request:
            with self.assertRaises(ValueError):
                release.invite_external_testers(None, '39')
            request.assert_not_called()

    def test_unassigned_build_cannot_send_mail(self):
        state = self.state()
        state[3]['groups'][0]['buildAssigned'] = False
        with patch.object(release, 'inventory', return_value=state), patch.object(release.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                release.email_testers(None, '39')
            run.assert_not_called()

    def invitation_state(self):
        state = self.state()
        state[3]['beta'] = {'externalBuildState': 'IN_BETA_TESTING'}
        state = (state[0], state[1], [{'id': 'existing-group', 'attributes': {'isInternalGroup': False}}], state[3])
        return state

    def test_installed_tester_does_not_receive_duplicate_join_invitation(self):
        tester = {'id': 'existing-tester', 'attributes': {'state': 'INSTALLED'}}
        with tempfile.TemporaryDirectory() as directory, patch.dict(release.os.environ, {'PAPZI_INVITATION_LEDGER': directory}), patch.object(release, 'inventory', return_value=self.invitation_state()), patch.object(release, 'listing', return_value=[tester]), patch.object(release, 'request') as request:
            report = release.invite_external_testers(None, '39')
            self.assertEqual(report['invitations']['alreadyJoined'], 1)
            request.assert_not_called()

    def test_provider_already_accepted_is_recorded_without_retry(self):
        tester = {'id': 'existing-tester', 'attributes': {'state': 'INVITED'}}
        error = release.ProviderError(409, ['STATE_ERROR.TESTER_INVITE.ALREADY_ACCEPTED'])
        with tempfile.TemporaryDirectory() as directory, patch.dict(release.os.environ, {'PAPZI_INVITATION_LEDGER': directory}), patch.object(release, 'inventory', return_value=self.invitation_state()), patch.object(release, 'listing', return_value=[tester]), patch.object(release, 'request', side_effect=error) as request:
            report = release.invite_external_testers(None, '39')
            self.assertEqual(report['invitations']['alreadyJoined'], 1)
            self.assertEqual(request.call_count, 1)
            self.assertEqual(len(list(Path(directory).glob('*.json'))), 1)

    def test_revoked_tester_is_not_reinvited(self):
        tester = {'id': 'existing-tester', 'attributes': {'state': 'REVOKED'}}
        with tempfile.TemporaryDirectory() as directory, patch.dict(release.os.environ, {'PAPZI_INVITATION_LEDGER': directory}), patch.object(release, 'inventory', return_value=self.invitation_state()), patch.object(release, 'listing', return_value=[tester]), patch.object(release, 'request') as request:
            report = release.invite_external_testers(None, '39')
            self.assertEqual(report['invitations']['appleAccepted'], 0)
            request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
