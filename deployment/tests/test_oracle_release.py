import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("oracle_release", Path(__file__).parents[1] / "oracle_release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def container(env):
    return {"Config": {"Env": [f"{k}={v}" for k, v in env.items()]}}


class ReleaseSafetyTests(unittest.TestCase):
    def test_repeat_rehearsal_checks_existing_archive_not_new_offers(self):
        with patch.object(release, "sql", side_effect=["t", "archived-identity"]) as query:
            self.assertEqual(release.dispatch_archive_identity("user", "database"), "archived-identity")
        self.assertIn("FROM papzii_legacy.dispatch_offers", query.call_args.args[2])
        with patch.object(release, "sql", side_effect=["f", "t", "legacy-identity"]) as query:
            self.assertEqual(release.dispatch_archive_identity("user", "database"), "legacy-identity")
        self.assertIn("FROM public.dispatch_offers", query.call_args.args[2])

    def test_new_empty_tables_do_not_look_like_lost_accounts(self):
        before = {"api_users": {"count": 14, "identity_digest": "same"}, "auth_credentials": "same"}
        after = {**before, "earnings": {"count": 0, "identity_digest": "empty"}}
        self.assertTrue(release.identities_preserved(before, after))
        self.assertFalse(release.identities_preserved(before, {**after, "auth_credentials": "changed"}))
        self.assertFalse(release.identities_preserved(before, {**before, "earnings": {"count": 1}}))
        self.assertFalse(release.identities_preserved(before, {"auth_credentials": "same"}))

    def test_database_identity_must_match_running_postgres(self):
        api = container({"DATABASE_URL": "postgresql://papzii:private@postgres:5432/papzii"})
        postgres = container({"POSTGRES_USER": "papzii", "POSTGRES_PASSWORD": "private"})
        database, user, _, _ = release.database_source(api, postgres)
        self.assertEqual((database, user), ("papzii", "papzii"))
        with self.assertRaises(ValueError):
            release.database_source(api, container({"POSTGRES_USER": "papzii", "POSTGRES_PASSWORD": "different"}))

    def test_qa_and_external_sources_are_rejected(self):
        pg = container({"POSTGRES_USER": "papzii", "POSTGRES_PASSWORD": "private"})
        for url in ("postgresql://papzii:private@postgres/papzii_qa_20261003", "postgresql://papzii:private@neon.invalid/papzii", "postgresql://papzii:private@postgres/papzii_restore"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                release.database_source(container({"DATABASE_URL": url}), pg)

    def test_neon_precedence_cannot_hide_wrong_database(self):
        api = container({"DATABASE_URL": "postgresql://papzii:private@postgres/papzii", "NEON_DATABASE_URL": "postgresql://papzii:private@neon.invalid/papzii"})
        with self.assertRaises(ValueError):
            release.database_source(api, container({"POSTGRES_USER": "papzii", "POSTGRES_PASSWORD": "private"}))

    def test_runtime_preserves_secrets_without_mocking_integrations(self):
        env = release.runtime_env({"MINIO_SECRET_KEY": "existing", "SMTP_PASSWORD": "existing-smtp", "NHOST_AUTH_URL": "https://unused.invalid", "NEON_DATABASE_URL": "unused"}, database_url="postgresql://private@postgres/restore", public_url="https://public.invalid", revision="a" * 40, proxy_ip="10.0.1.7")
        self.assertEqual(env["MINIO_SECRET_KEY"], "existing")
        self.assertEqual(env["SMTP_PASSWORD"], "existing-smtp")
        self.assertEqual(env["ALLOW_RUNTIME_SCHEMA_CHANGES"], "false")
        self.assertEqual(env["FORWARDED_ALLOW_IPS"], "10.0.1.7")
        self.assertNotIn("NHOST_AUTH_URL", env)
        self.assertNotIn("NEON_DATABASE_URL", env)
        self.assertNotIn("PAYFAST_MERCHANT_ID", env)

    def test_only_correct_service_digests_are_allowed(self):
        for image in ("ghcr.io/mngomazar/papzi-api:latest", "other/api@sha256:" + "a" * 64, "ghcr.io/mngomazar/papzi-worker@sha256:" + "a" * 64):
            with self.subTest(image=image), self.assertRaises(ValueError):
                release.validate_image(image, "api", "a" * 40)
        with patch.object(release, "inspect", return_value={"Config": {"Labels": {"org.opencontainers.image.revision": "b" * 40}}}), self.assertRaises(ValueError):
            release.validate_image("ghcr.io/mngomazar/papzi-api@sha256:" + "a" * 64, "api", "a" * 40)

    def test_private_files_reject_overwrite_and_environment_injection(self):
        with tempfile.TemporaryDirectory() as root:
            envfile = Path(root) / "restore.env"
            release.write_env(envfile, {"SECRET": "value"})
            with self.assertRaises(FileExistsError):
                release.write_env(envfile, {"SECRET": "replacement"})
            with self.assertRaises(ValueError):
                release.write_env(Path(root) / "bad.env", {"SECRET": "value\nINJECTED=true"})


if __name__ == "__main__":
    unittest.main()
