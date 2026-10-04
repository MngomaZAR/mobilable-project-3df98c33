import importlib.util
import io
import json
from email.message import Message
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError


spec = importlib.util.spec_from_file_location("verify_backend_release", Path(__file__).parents[1] / "verify_backend_release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
REVISION = "a" * 40
ENDPOINTS = release.release_endpoints("https://api.example.com/health")


def documents():
    return [
        {"status": "ok", "environment": "production"},
        {"version": REVISION, "environment": "production"},
        {"ok": True},
        {"version": REVISION, "environment": "production",
         "required_capabilities_available": True, "blockers": [],
         "capabilities": {name: True for name in release.REQUIRED_CAPABILITIES}},
    ]


class ReleaseVerificationTests(unittest.TestCase):
    def test_subpath_and_same_origin_contract_are_preserved(self):
        urls = release.release_endpoints("https://api.example.com/v1/health/", "https://api.example.com/v1/schema")
        self.assertEqual(urls["version"], "https://api.example.com/v1/version")
        self.assertEqual(urls["contract"], "https://api.example.com/v1/schema")

    def test_insecure_private_credentialed_or_off_origin_endpoints_fail(self):
        values = ["http://api.example.com/health", "https://localhost/health",
                  "https://x.localhost/health", "https://x.local/health",
                  "https://127.0.0.1/health", "https://[::1]/health",
                  "https://10.0.1.7/health", "https://u:private@api.example.com/health",
                  "https://api.example.com/health?token=private",
                  "https://api.example.com/health#anything", "https://api.example.com:8000/health",
                  "https://api.example.com/version"]
        for url in values:
            with self.subTest(url=url), self.assertRaises(ValueError):
                release.release_endpoints(url)
        with self.assertRaises(ValueError):
            release.release_endpoints("https://api.example.com/health", "https://old.example.com/health/contract")

    def test_full_commit_is_required_and_validated_before_network_access(self):
        for revision in ("main", "latest", "a" * 7, "A" * 40, "a" * 40 + "\n"):
            with self.subTest(revision=revision), patch.object(release, "get_json") as get, self.assertRaises(ValueError):
                release.verify_release(ENDPOINTS, revision)
            get.assert_not_called()

    def test_exact_healthy_production_api_passes_without_claiming_whole_app_acceptance(self):
        with patch.object(release, "get_json", side_effect=documents()) as get:
            result = release.verify_release(ENDPOINTS, REVISION, attempts=1)
        self.assertTrue(result["api_verified"])
        self.assertEqual(result["revision"], REVISION)
        self.assertIn("Native device tests", result["acceptance_still_required"])
        self.assertIn("Worker image identity", result["acceptance_still_required"])
        self.assertEqual(get.call_count, 4)

    def test_old_healthy_api_cannot_pass(self):
        docs = documents()
        docs[1]["version"] = "b" * 40
        with patch.object(release, "get_json", side_effect=docs), self.assertRaises(release.VerificationFailure) as failed:
            release.verify_release(ENDPOINTS, REVISION, attempts=1)
        self.assertEqual(failed.exception.stage, "version")

    def test_qa_environment_does_not_pass_as_production(self):
        docs = documents()
        docs[0]["environment"] = "qa"
        with patch.object(release, "get_json", side_effect=docs), self.assertRaises(release.VerificationFailure) as failed:
            release.verify_release(ENDPOINTS, REVISION, attempts=1)
        self.assertEqual(failed.exception.stage, "health")

    def test_string_true_schema_is_not_a_pass(self):
        docs = documents()
        docs[2]["ok"] = "true"
        with patch.object(release, "get_json", side_effect=docs), self.assertRaises(release.VerificationFailure) as failed:
            release.verify_release(ENDPOINTS, REVISION, attempts=1)
        self.assertEqual(failed.exception.stage, "contract")

    def test_mixed_revision_readiness_does_not_pass(self):
        docs = documents()
        docs[3]["version"] = "b" * 40
        with patch.object(release, "get_json", side_effect=docs), self.assertRaises(release.VerificationFailure) as failed:
            release.verify_release(ENDPOINTS, REVISION, attempts=1)
        self.assertEqual(failed.exception.stage, "readiness")

    def test_missing_false_string_or_extra_disabled_capability_fails_even_when_root_says_true(self):
        for mode in ("missing", "false", "string", "unknown"):
            docs = documents()
            caps = docs[3]["capabilities"]
            if mode == "missing":
                caps.pop("bank_payout_execution")
            elif mode == "unknown":
                caps["new_required_service"] = False
            else:
                caps["bank_payout_execution"] = False if mode == "false" else "true"
            with self.subTest(mode=mode), patch.object(release, "get_json", side_effect=docs), \
                    patch.object(release.time, "sleep") as sleep, self.assertRaises(release.VerificationFailure) as failed:
                release.verify_release(ENDPOINTS, REVISION)
            self.assertEqual(failed.exception.stage, "readiness")
            self.assertFalse(failed.exception.retryable)
            sleep.assert_not_called()

    def test_nonempty_blockers_cannot_be_ignored(self):
        docs = documents()
        docs[3]["blockers"] = ["unavailable"]
        with patch.object(release, "get_json", side_effect=docs), self.assertRaises(release.VerificationFailure):
            release.verify_release(ENDPOINTS, REVISION, attempts=1)

    def test_retry_waits_for_expected_commit_then_checks_contract(self):
        first = documents()[:2]
        first[1]["version"] = "b" * 40
        with patch.object(release, "get_json", side_effect=first + documents()), patch.object(release.time, "sleep") as sleep:
            self.assertTrue(release.verify_release(ENDPOINTS, REVISION, attempts=2)["api_verified"])
        sleep.assert_called_once_with(10)

    def test_polling_is_bounded(self):
        for attempts, interval in ((0, 10), (19, 10), (1, -1), (1, 11)):
            with self.subTest(attempts=attempts, interval=interval), patch.object(release, "get_json") as get, self.assertRaises(ValueError):
                release.verify_release(ENDPOINTS, REVISION, attempts=attempts, interval=interval)
            get.assert_not_called()


class TransportTests(unittest.TestCase):
    def response(self, body, content_type="application/json"):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.status = 200
        response.headers = Message()
        response.headers["Content-Type"] = content_type
        response.read.return_value = body
        return response

    def test_json_transport_has_timeout_size_limit_and_no_authentication(self):
        response = self.response(b'{"status":"ok"}')
        with patch.object(release, "build_opener") as build:
            build.return_value.open.return_value = response
            self.assertEqual(release.get_json(ENDPOINTS["health"]), {"status": "ok"})
        request = build.return_value.open.call_args.args[0]
        self.assertIsNone(request.get_header("Authorization"))
        self.assertEqual(build.return_value.open.call_args.kwargs["timeout"], 8)
        response.read.assert_called_once_with(release.MAX_RESPONSE_BYTES + 1)

    def test_html_invalid_json_nonobject_and_large_bodies_fail(self):
        cases = [(b'<html>sign in</html>', "text/html"), (b'not json', "application/json"),
                 (b'[]', "application/json"), (b'1', "application/json"),
                 (b'x' * (release.MAX_RESPONSE_BYTES + 1), "application/json")]
        for body, kind in cases:
            with self.subTest(kind=kind, size=len(body)), patch.object(release, "build_opener") as build, self.assertRaises(ValueError):
                build.return_value.open.return_value = self.response(body, kind)
                release.get_json(ENDPOINTS["health"])

    def test_redirects_are_not_followed_or_reported_as_success(self):
        handler = release.NoRedirects()
        self.assertIsNone(handler.redirect_request(None, None, 302, "Found", {}, "https://other.example.com/login"))
        error = HTTPError(ENDPOINTS["health"], 302, "Sensitive server response", {}, io.BytesIO(b'private'))
        with patch.object(release, "build_opener") as build, self.assertRaisesRegex(ValueError, "^HTTP 302$"):
            build.return_value.open.side_effect = error
            release.get_json(ENDPOINTS["health"])


if __name__ == "__main__":
    unittest.main()
