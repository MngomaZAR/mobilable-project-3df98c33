import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('pilot', Path(__file__).parents[1] / 'release-play-pilot.py')
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


class PilotScopeTests(unittest.TestCase):
    def test_exact_internal_version_only(self):
        track = {'track': 'internal', 'releases': [
            {'versionCodes': ['5'], 'status': 'draft'}, {'versionCodes': ['4'], 'status': 'completed'}]}
        self.assertEqual(pilot.pilot_release(track), {'track': 'internal', 'releases': [
            {'versionCodes': ['5'], 'status': 'completed'}]})
        self.assertEqual(track['releases'][0]['status'], 'draft')

    def test_public_missing_mixed_or_newer_versions_rejected(self):
        for track in [
            {'track': 'production', 'releases': [{'versionCodes': ['5'], 'status': 'draft'}]},
            {'track': 'internal', 'releases': []},
            {'track': 'internal', 'releases': [{'versionCodes': ['4', '5'], 'status': 'draft'}]},
            {'track': 'internal', 'releases': [{'versionCodes': ['5'], 'status': 'draft'}, {'versionCodes': ['6'], 'status': 'completed'}]},
        ]:
            with self.assertRaises(ValueError):
                pilot.pilot_release(track)


if __name__ == '__main__':
    unittest.main()
