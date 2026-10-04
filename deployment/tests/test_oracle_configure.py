import importlib.util
from pathlib import Path
import sys
import unittest


directory = Path(__file__).parents[1]
sys.path.insert(0, str(directory))
spec = importlib.util.spec_from_file_location("oracle_configure", directory / "oracle_configure.py")
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class ConfigurationSafetyTests(unittest.TestCase):
    def test_cannot_change_release_or_financial_acceptance(self):
        for key in ("DATABASE_URL", "API_PUBLIC_URL", "ADMIN_USER_IDS", "APP_ENV", "PAYFAST_SANDBOX", "FINANCIAL_PAYOUT_ACCEPTANCE_ID", "ALLOW_RUNTIME_SCHEMA_CHANGES", "EXPO_PUBLIC_API_KEY"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                configure.validate_updates({key: "value"})

    def test_rejects_multiline_empty_and_nonstring_values(self):
        for value in ("", "key\nOTHER=value", "key\x00", True, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                configure.validate_updates({"LIVEKIT_API_KEY": value})

    def test_requires_secure_noncredential_endpoints(self):
        for url in ("ws://video.example.test", "wss://secret@video.example.test", "wss://video.example.test?token=secret", "wss://video.example.test#secret"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                configure.validate_updates({"LIVEKIT_URL": url})
        self.assertEqual(configure.validate_updates({"LIVEKIT_URL": "wss://video.example.test"}), {"LIVEKIT_URL": "wss://video.example.test"})

    def test_only_changes_operational_env_and_preserves_owner_allowlist(self):
        original = {"services": {"api": {"image": "immutable-api", "networks": ["proxy"]}, "worker": {"image": "immutable-worker"}, "postgres": {"volumes": ["existing:/data"]}}, "volumes": {"existing": {}}}
        env = {"DATABASE_URL": "same", "ADMIN_USER_IDS": "other-owner", "KEEP": "unchanged"}
        result = configure.configured_compose(original, env, env, {"LIVEKIT_ENABLED": "true"}, "verified-owner")
        self.assertEqual(result["volumes"], original["volumes"])
        self.assertEqual(result["services"]["postgres"], original["services"]["postgres"])
        self.assertNotIn("environment", original["services"]["api"])
        for name in ("api", "worker"):
            self.assertEqual(result["services"][name]["image"], original["services"][name]["image"])
            self.assertEqual(result["services"][name]["environment"]["DATABASE_URL"], "same")
            self.assertEqual(result["services"][name]["environment"]["KEEP"], "unchanged")
            self.assertEqual(result["services"][name]["environment"]["ADMIN_USER_IDS"], "other-owner,verified-owner")

    def test_requires_same_database_and_no_rebuild(self):
        original = {"services": {"api": {"image": "api"}, "worker": {"image": "worker"}}}
        with self.assertRaises(ValueError):
            configure.configured_compose(original, {"DATABASE_URL": "production"}, {"DATABASE_URL": "qa"}, {"LIVEKIT_ENABLED": "true"})
        original["services"]["api"]["build"] = "source"
        with self.assertRaises(ValueError):
            configure.configured_compose(original, {"DATABASE_URL": "same"}, {"DATABASE_URL": "same"}, {"LIVEKIT_ENABLED": "true"})

    def test_merchant_configuration_cannot_activate_checkout_or_mix_credentials(self):
        values = {"PAYFAST_MERCHANT_ID": "unit-merchant", "PAYFAST_MERCHANT_KEY": "unit-key",
                  "PAYFAST_PASSPHRASE": "unit phrase", "PAYFAST_SANDBOX": "false",
                  "PAYFAST_CHECKOUT_ENABLED": "false"}
        self.assertEqual(configure.validate_updates(values), values)
        with self.assertRaises(ValueError):
            configure.validate_updates({**values, "PAYFAST_CHECKOUT_ENABLED": "true"})
        for key in values:
            with self.subTest(key=key), self.assertRaises(ValueError):
                configure.validate_updates({name: value for name, value in values.items() if name != key})

    def test_rejects_in_place_merchant_rotation(self):
        config = {"services": {"api": {"image": "api"}, "worker": {"image": "worker"}}}
        env = {"DATABASE_URL": "same", "PAYFAST_MERCHANT_ID": "old-merchant"}
        values = {"PAYFAST_MERCHANT_ID": "new-merchant", "PAYFAST_MERCHANT_KEY": "unit-key",
                  "PAYFAST_PASSPHRASE": "unit phrase", "PAYFAST_SANDBOX": "false",
                  "PAYFAST_CHECKOUT_ENABLED": "false"}
        with self.assertRaises(ValueError):
            configure.configured_compose(config, env, env, values)


if __name__ == "__main__":
    unittest.main()
