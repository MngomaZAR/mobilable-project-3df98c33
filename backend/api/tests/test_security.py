import base64
import time
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.access_control import authorize_query, redact_result
from app.booking_engine import BookingInput, calculate_quote, fingerprint, money
from app.config import Settings, get_settings
from app.main import app
from app.database import SqlBuilder, query_column_types
from app.payments import parse_notification, signature
from app.storage import put_object, read_object, signed_url
from app.readiness import release_capabilities


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.settings = Settings(_env_file=None, DATABASE_URL="postgresql://unused", API_PUBLIC_URL="https://api.example.test", MINIO_SECRET_KEY="unit-test-secret", ADMIN_USER_IDS="trusted-admin")
        self.user = {"id": "client-a"}

    def assert_denied(self, table, payload, user=None):
        with self.assertRaises(HTTPException) as error:
            authorize_query(self.settings, table, payload, user)
        self.assertIn(error.exception.status_code, {400, 401, 403})

    def test_auth_tables_never_exposed(self):
        for table in ["api_users", "api_sessions", "api_schema_migrations"]:
            self.assert_denied(table, {"action": "select"}, self.user)

    def test_anonymous_cannot_read_private_tables(self):
        for table in ["bookings", "payments", "messages", "kyc_documents", "job_outbox"]:
            self.assert_denied(table, {"action": "select"})

    def test_role_claim_is_not_admin_authority(self):
        self.assert_denied("job_outbox", {"action": "select"}, {"id": "attacker", "user_metadata": {"role": "admin"}})

    def test_ownership_is_forced_and_scope_survives_or_filter(self):
        command, scope = authorize_query(self.settings, "bookings", {"action": "select", "filters": [{"op": "or", "value": "client_id.eq.victim,status.eq.pending"}]}, self.user)
        self.assertEqual(scope[1], ["client-a"])
        self.assertIn('"client_id"', scope[0])
        command, scope = authorize_query(self.settings, "posts", {"action": "insert", "payload": {"caption": "hi"}}, self.user)
        self.assertEqual(command["payload"]["author_id"], "client-a")

    def test_verification_and_money_cannot_be_written(self):
        for table, fields in [("profiles", {"role": "admin"}), ("profiles", {"verified": True}), ("profiles", {"kyc_status": "approved"}), ("earnings", {"amount": 100}), ("payments", {"status": "completed"}), ("payout_methods", {"verified": True}), ("photographers", {"rating": 5})]:
            self.assert_denied(table, {"action": "update", "payload": fields}, self.user)

    def test_feed_moderation_cannot_be_bypassed(self):
        self.assert_denied("posts", {"action": "update", "payload": {"moderation_status": "approved"}}, self.user)
        self.assert_denied("post_likes", {"action": "insert", "payload": {"post_id": "hidden-post"}}, self.user)
        command, scope = authorize_query(self.settings, "posts", {"action": "insert", "payload": {"caption": "new"}}, self.user)
        self.assertEqual(command["payload"]["moderation_status"], "pending")
        _, scope = authorize_query(self.settings, "posts", {"action": "select"}, self.user)
        self.assertIn("moderation_status='approved'", scope[0])

    def test_equipment_owner_and_array_contract(self):
        command, scope = authorize_query(self.settings, "photographer_equipment", {"action": "upsert", "payload": {"tier_id": "standard", "camera_body": "QA Camera", "lenses": ["prime"], "extras": []}}, self.user)
        self.assertEqual(command["payload"]["photographer_id"], "client-a")
        self.assertEqual(scope[1], ["client-a"])
        self.assert_denied("photographer_equipment", {"action": "upsert", "payload": {"photographer_id": "victim", "lenses": []}}, self.user)
        self.assert_denied("photographer_equipment", {"action": "upsert", "payload": {"lenses": "[not an array]"}}, self.user)
        self.assert_denied("photographer_equipment", {"action": "insert", "payload": {"tier_id": "invalid"}}, self.user)
        self.assert_denied("photographer_equipment", {"action": "insert", "payload": {"camera_body": "QA"}})

    def test_model_services_reject_unsupported_content_and_invalid_rates(self):
        _, scope = authorize_query(self.settings, "model_services", {"action": "select"}, None)
        self.assertIn("'fashion_shoot'", scope[0])
        self.assertIn('"model_services"."service_type"', scope[0])
        self.assertNotIn("'adult_content'", scope[0])
        self.assert_denied("model_services", {"action": "upsert", "payload": {"service_type": "adult_content", "rate_zar": 5000}}, self.user)
        self.assert_denied("model_services", {"action": "upsert", "payload": {"service_type": "fashion_shoot", "rate_zar": "NaN"}}, self.user)
        self.assert_denied("model_services", {"action": "upsert", "payload": {"service_type": "fashion_shoot", "rate_zar": 0}}, self.user)
        _, scope = authorize_query(self.settings, "model_services", {"action": "update", "payload": {"is_active": True}}, self.user)
        self.assertIn('"model_id"', scope[0])
        self.assertIn("'fashion_shoot'", scope[0])

    def test_public_profiles_hide_private_fields_and_reject_private_search(self):
        result = redact_result(self.settings, "profiles", {"data": [{"id": "victim", "full_name": "Creator", "phone": "private", "email": "private"}]}, self.user)
        self.assertNotIn("email", result["data"][0])
        self.assert_denied("profiles", {"action": "select", "filters": [{"op": "eq", "column": "phone", "value": "private"}]}, self.user)

    def test_payment_signatures_encode_passphrase_and_reject_duplicates(self):
        settings = Settings(_env_file=None, PAYFAST_MERCHANT_ID="test", PAYFAST_PASSPHRASE="space & plus+")
        fields = {"merchant_id": "test", "m_payment_id": "order", "pf_payment_id": "gateway", "amount_gross": "100.00", "payment_status": "COMPLETE"}
        from urllib.parse import urlencode
        fields["signature"] = signature(fields, settings.payfast_passphrase)
        self.assertEqual(parse_notification(urlencode(fields).encode(), settings)["amount_gross"], "100.00")
        with self.assertRaises(HTTPException):
            parse_notification((urlencode(fields) + "&amount_gross=1.00").encode(), settings)
        fields["amount_gross"] = "1.00"
        with self.assertRaises(HTTPException):
            parse_notification(urlencode(fields).encode(), settings)

    def test_media_gateway_never_exposes_internal_host(self):
        result = signed_url(self.settings, "avatars", "users/client-a/photo.jpg")
        self.assertTrue(result["url"].startswith("https://api.example.test/storage/avatar?"))
        self.assertNotIn('expiry=', result['url'])
        with self.assertRaises(HTTPException):
            read_object(self.settings, "avatars", "users/client-a/photo.jpg", int(time.time()) - 1, "forged")
        with self.assertRaises(HTTPException):
            put_object(self.settings, {"bucket": "avatars", "base64": base64.b64encode(b"<script>bad</script>").decode(), "contentType": "image/jpeg"}, "client-a")

    def test_booking_input_and_server_money(self):
        start = datetime.now(UTC) + timedelta(days=1)
        command = BookingInput(photographer_id="p", package_id="essential", start_datetime=start, end_datetime=start + timedelta(hours=1), user_latitude=-29.85, user_longitude=31.03, idempotency_key="retry-key")
        quote = calculate_quote(self.settings, command, {"latitude": -29.85, "longitude": 31.03})
        self.assertEqual(quote["total_amount"], money(1400))
        self.assertEqual(quote["commission_amount"], money(280))
        self.assertEqual(quote["payout_amount"], money(1120))
        self.assertEqual(fingerprint(command), fingerprint(command.model_copy(update={"idempotency_key": "other-key"})))
        with self.assertRaises(ValidationError):
            BookingInput(**{**command.model_dump(), "model_id": "model"})

    def test_http_media_allowed_only_for_isolated_qa_loopback(self):
        for environment, url in [('production', 'http://127.0.0.1:18000'), ('qa', 'http://api.example.test')]:
            with self.assertRaises(HTTPException):
                signed_url(self.settings.model_copy(update={'app_env': environment, 'api_public_url': url}), 'avatars', 'users/client-a/test.jpg')
        qa = self.settings.model_copy(update={'app_env': 'qa', 'api_public_url': 'http://127.0.0.1:18000'})
        self.assertTrue(signed_url(qa, 'avatars', 'users/client-a/test.jpg')['url'].startswith('http://127.0.0.1:18000/storage/avatar'))

    def test_api_rejects_missing_and_invalid_tokens(self):
        app.dependency_overrides[get_settings] = lambda: self.settings
        try:
            with TestClient(app) as client, patch("app.main.user_from_access_token", new=AsyncMock(side_effect=HTTPException(status_code=401, detail="Invalid session"))):
                self.assertEqual(client.get("/auth/me").status_code, 401)
                self.assertEqual(client.post("/data/api_users", json={"action": "select"}, headers={"Authorization": "Bearer bad"}).status_code, 401)
                self.assertEqual(client.post("/storage/upload", json={}).status_code, 401)
        finally:
            app.dependency_overrides.clear()

    def test_boolean_and_numeric_filters_use_postgres_types(self):
        builder = SqlBuilder({"is_available": "boolean", "rating": "numeric"})
        sql = builder.where_sql([{"op": "is", "column": "is_available", "value": True}, {"op": "eq", "column": "rating", "value": "5"}])
        self.assertIn('"is_available" IS TRUE', sql)
        self.assertEqual(builder.values, [money(5)])

    def test_batched_generic_writes_cannot_bypass_availability_command(self):
        app.dependency_overrides[get_settings] = lambda: self.settings
        try:
            with TestClient(app) as client, patch('app.main.user_from_access_token', AsyncMock(return_value=self.user)), patch('app.main.require_user', AsyncMock(return_value=self.user)), patch('app.main.execute_table_query', AsyncMock()) as database:
                for table, field in [('profiles', 'availability_status'), ('photographers', 'is_online'), ('models', 'is_online')]:
                    response = client.post(f'/data/{table}', headers={'Authorization': 'Bearer unit-token'}, json={'action': 'upsert', 'payload': [{'id': 'client-a', field: True}], 'onConflict': 'id'})
                    self.assertEqual(response.status_code, 403)
                database.assert_not_awaited()
        finally:
            app.dependency_overrides.clear()

    def test_healthy_api_is_not_marketplace_launch_readiness(self):
        result = release_capabilities(self.settings)
        self.assertFalse(result["required_capabilities_available"])
        for feature in ["video_call_service", "payment_refund_execution", "bank_payout_execution", "account_recovery_email"]:
            self.assertIn(feature, result["blockers"])
        serialized = str(result)
        self.assertNotIn(self.settings.minio_secret_key, serialized)


class SchemaCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_production_column_types_cached_without_runtime_ddl(self):
        settings = Settings(_env_file=None, DATABASE_URL="postgresql://cache-test")
        conn = AsyncMock()
        conn.fetch.return_value = [{"column_name": "rating", "data_type": "numeric"}]
        self.assertEqual(await query_column_types(conn, settings, "photographers"), {"rating": "numeric"})
        await query_column_types(conn, settings, "photographers")
        self.assertEqual(conn.fetch.await_count, 1)
        runtime_settings = Settings(_env_file=None, DATABASE_URL="postgresql://cache-test", ALLOW_RUNTIME_SCHEMA_CHANGES=True)
        await query_column_types(conn, runtime_settings, "photographers")
        self.assertEqual(conn.fetch.await_count, 2)
        conn.execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
