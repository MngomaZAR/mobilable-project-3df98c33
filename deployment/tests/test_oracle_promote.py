import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


directory = Path(__file__).parents[1]
sys.path.insert(0, str(directory))
spec = importlib.util.spec_from_file_location("oracle_promote", directory / "oracle_promote.py")
promote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promote)


class PromotionSafetyTests(unittest.TestCase):
    def test_revision_is_checked_from_version_not_health(self):
        import json
        revision = "a" * 40
        result = {"health": {"status": "ok"}, "version": {"version": revision}}
        worker = {"State": {"Status": "running"}, "RestartCount": 0}
        with patch.object(promote.release, "command", return_value=json.dumps(result).encode()) as run, patch.object(promote.release, "inspect", return_value=worker):
            self.assertEqual(promote.internal_acceptance(revision), result)
        self.assertIn("get('/version')", run.call_args.args[0][-1])

    def test_only_api_worker_are_changed_and_no_rebuild_is_left(self):
        original = {"services": {"api": {"image": "old", "build": "old-source", "networks": {"default": None, "dokploy-network": None}}, "worker": {"image": "old-worker", "build": "old-source"}, "postgres": {"image": "postgres:16-alpine", "volumes": ["existing:/data"]}}, "volumes": {"existing": {"name": "preserved"}}}
        result = promote.compose_env(original, {"DATABASE_URL": "same"}, {"DATABASE_URL": "same"}, "api@sha256:immutable", "worker@sha256:immutable")
        self.assertEqual(result["services"]["postgres"], original["services"]["postgres"])
        self.assertEqual(result["volumes"], original["volumes"])
        self.assertEqual(result["services"]["api"]["networks"], original["services"]["api"]["networks"])
        self.assertNotIn("build", result["services"]["api"])
        self.assertNotIn("build", result["services"]["worker"])
        self.assertEqual(original["services"]["api"]["image"], "old")

    def test_atomic_replacement_does_not_leave_partial_proxy_file(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "proxy.yml"
            path.write_text("original")
            promote.replace_file(path, "replacement")
            self.assertEqual(path.read_text(), "replacement")
            self.assertFalse((Path(root) / "proxy.yml.release-tmp").exists())

    def test_maintenance_refuses_mutations_as_well_as_reads(self):
        for method in ("do_POST=do_GET", "do_PATCH=do_GET", "do_DELETE=do_GET", "do_PUT=do_GET"):
            self.assertIn(method, promote.MAINTENANCE_SERVER)
        self.assertIn("self.send_response(503)", promote.MAINTENANCE_SERVER)
        self.assertIn("Retry-After", promote.MAINTENANCE_SERVER)


if __name__ == "__main__":
    unittest.main()
