import importlib.util
import base64
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone


directory = Path(__file__).parents[1]
sys.path.insert(0, str(directory))
spec = importlib.util.spec_from_file_location("oracle_configure", directory / "oracle_configure.py")
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class ConfigurationSafetyTests(unittest.TestCase):
    def test_bank_key_must_be_canonical_32_byte_fernet_key(self):
        key = base64.urlsafe_b64encode(b'K' * 32).decode()
        self.assertEqual(configure.validate_updates({configure.BANK_KEY: key}), {configure.BANK_KEY: key})
        for value in ('placeholder', base64.urlsafe_b64encode(b'K' * 16).decode(), key.rstrip('='), key + ' '):
            with self.subTest(value=value), self.assertRaises(ValueError):
                configure.validate_updates({configure.BANK_KEY: value})

    def test_initialization_uses_secure_random_bytes_only_when_both_keys_are_missing(self):
        with patch.object(configure.secrets, 'token_bytes', return_value=b'K' * 32) as random:
            updates = configure.bank_initialization_updates({}, {})
        random.assert_called_once_with(32)
        self.assertEqual(set(updates), {configure.BANK_KEY})
        configure.validate_bank_key(updates[configure.BANK_KEY])

    def test_initialization_preserves_existing_matching_key_without_generating_another(self):
        key = base64.urlsafe_b64encode(b'K' * 32).decode()
        env = {configure.BANK_KEY: key}
        with patch.object(configure.secrets, 'token_bytes') as random:
            self.assertEqual(configure.bank_initialization_updates(env, env), env)
        random.assert_not_called()

    def test_partial_or_different_runtime_keys_require_reconciliation(self):
        key = base64.urlsafe_b64encode(b'K' * 32).decode()
        other = base64.urlsafe_b64encode(b'J' * 32).decode()
        for api, worker in (({configure.BANK_KEY: key}, {}), ({}, {configure.BANK_KEY: key}),
                            ({configure.BANK_KEY: key}, {configure.BANK_KEY: other})):
            with self.subTest(api_has_key=bool(api), worker_has_key=bool(worker)), self.assertRaises(ValueError):
                configure.bank_initialization_updates(api, worker)
            with self.assertRaises(ValueError):
                configure.guard_bank_key_update(api, worker, {configure.BANK_KEY: key}, 0)

    def test_missing_key_is_initialized_only_over_an_empty_bank_store(self):
        updates = {configure.BANK_KEY: base64.urlsafe_b64encode(b'K' * 32).decode()}
        configure.guard_bank_key_update({}, {}, updates, 0)
        for count in (1, 10, -1):
            with self.subTest(count=count), self.assertRaises(ValueError):
                configure.guard_bank_key_update({}, {}, updates, count)

    def test_existing_key_is_preserved_with_or_without_bank_records(self):
        env = {configure.BANK_KEY: base64.urlsafe_b64encode(b'K' * 32).decode()}
        configure.guard_bank_key_update(env, env, env, 20)
        changed = {configure.BANK_KEY: base64.urlsafe_b64encode(b'J' * 32).decode()}
        with self.assertRaises(ValueError):
            configure.guard_bank_key_update(env, env, changed, 0)

    def test_compose_cannot_replace_an_existing_bank_key(self):
        config = {"services": {"api": {"image": "api"}, "worker": {"image": "worker"}}}
        env = {"DATABASE_URL": "same", configure.BANK_KEY: base64.urlsafe_b64encode(b'K' * 32).decode()}
        changed = {configure.BANK_KEY: base64.urlsafe_b64encode(b'J' * 32).decode()}
        with self.assertRaises(ValueError):
            configure.configured_compose(config, env, env, changed)
        result = configure.configured_compose(config, env, env, {configure.BANK_KEY: env[configure.BANK_KEY]})
        self.assertEqual(result['services']['api']['environment'][configure.BANK_KEY], env[configure.BANK_KEY])
        self.assertNotIn('STITCH_PAYOUTS_ENABLED', result['services']['api']['environment'])

    def test_named_acceptance_access_is_bounded_and_payment_cap_is_validated(self):
        expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        config = {'SERVICE_ACCEPTANCE_USER_IDS': 'client,creator', 'SERVICE_ACCEPTANCE_EXPIRES_AT': expiry,
                  'PAYFAST_ACCEPTANCE_MAX_AMOUNT': '50.00'}
        self.assertEqual(configure.validate_updates(config), config)
        for changes in ({'SERVICE_ACCEPTANCE_USER_IDS': '*'}, {'SERVICE_ACCEPTANCE_EXPIRES_AT': '2026-10-04T12:00:00'},
                        {'SERVICE_ACCEPTANCE_EXPIRES_AT': (datetime.now(timezone.utc) + timedelta(hours=25)).isoformat()},
                        {'PAYFAST_ACCEPTANCE_MAX_AMOUNT': '501'}, {'PAYFAST_ACCEPTANCE_MAX_AMOUNT': 'NaN'},
                        {'PAYFAST_ACCEPTANCE_MAX_AMOUNT': '0'}, {'PAYFAST_ACCEPTANCE_MAX_AMOUNT': '50.001'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                configure.validate_updates({**config, **changes})
        with self.assertRaises(ValueError):
            configure.validate_updates({'SERVICE_ACCEPTANCE_USER_IDS': 'client'})

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

    def test_preserves_persistent_recovery_encryption_key(self):
        config = {"services": {"api": {"image": "api"}, "worker": {"image": "worker"}}}
        env = {"DATABASE_URL": "same", "RECOVERY_ENCRYPTION_KEY": "existing-key"}
        with self.assertRaises(ValueError):
            configure.configured_compose(config, env, env, {"RECOVERY_ENCRYPTION_KEY": "replacement-key"})
        result = configure.configured_compose(config, env, env, {"RECOVERY_ENCRYPTION_KEY": "existing-key"})
        self.assertEqual(result["services"]["worker"]["environment"]["RECOVERY_ENCRYPTION_KEY"], "existing-key")


if __name__ == "__main__":
    unittest.main()
