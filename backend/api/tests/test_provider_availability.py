import unittest
from copy import deepcopy
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.provider_availability import AvailabilityCommand, read_availability, router, set_availability


def settings():
    return Settings(_env_file=None, DATABASE_URL="postgresql://unused")


class MemoryTransaction:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        self.before = deepcopy((self.conn.profiles, self.conn.providers))
        self.conn.events.append("begin")

    async def __aexit__(self, kind, value, trace):
        if kind:
            self.conn.profiles, self.conn.providers = self.before
            self.conn.events.append("rollback")
        else:
            self.conn.events.append("commit")


class MemoryConnection:
    """Tests command boundaries and rollback; real PostgreSQL locking needs integration QA."""
    def __init__(self, role="photographer", kyc="approved"):
        self.profiles = {
            "owner": {"role": role, "kyc_status": kyc, "availability_status": "offline"},
            "victim": {"role": "model", "kyc_status": "approved", "availability_status": "offline"},
        }
        self.providers = {
            "models": {"owner": {"id": "owner", "is_online": False}, "victim": {"id": "victim", "is_online": False}},
            "photographers": {"owner": {"id": "owner", "is_online": False}},
        }
        self.calls = []
        self.events = []
        self.fail_table = None
        self.zero_table = None

    def transaction(self):
        return MemoryTransaction(self)

    async def close(self):
        self.events.append("close")

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        self.assert_in_transaction()
        if "FROM profiles" in sql:
            return deepcopy(self.profiles.get(args[0]))
        for table in self.providers:
            if f"FROM {table}" in sql:
                return deepcopy(self.providers[table].get(args[0]))
        raise AssertionError(f"Unexpected query: {sql}")

    def assert_in_transaction(self):
        if not self.events or self.events[-1] != "begin":
            raise AssertionError("Query outside transaction")

    async def execute(self, sql, *args):
        self.calls.append((sql, args))
        self.assert_in_transaction()
        if sql.startswith("SELECT pg_advisory"):
            return "SELECT 1"
        table = sql.split()[1]
        if table == self.fail_table:
            raise RuntimeError("injected database failure")
        if table == self.zero_table:
            return "UPDATE 0"
        if table == "profiles":
            self.profiles[args[0]]["availability_status"] = args[1]
        elif table in self.providers:
            self.providers[table][args[0]]["is_online"] = args[1]
        else:
            raise AssertionError(f"Unexpected query: {sql}")
        return "UPDATE 1"


class AvailabilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_both_provider_roles_update_only_the_authenticated_owner_atomically(self):
        for role, table in [("model", "models"), ("photographer", "photographers")]:
            with self.subTest(role=role):
                conn = MemoryConnection(role)
                command = AvailabilityCommand.model_validate({"is_online": True, "id": "victim", "provider_id": "victim", "role": "client"})
                with patch("app.provider_availability.connect", new=AsyncMock(return_value=conn)):
                    response = await set_availability(settings(), command, {"id": "owner", "role": "client"})
                self.assertTrue(response["is_online"])
                self.assertEqual(response["role"], role)
                self.assertEqual(conn.profiles["owner"]["availability_status"], "online")
                self.assertTrue(conn.providers[table]["owner"]["is_online"])
                self.assertEqual(conn.profiles["victim"]["availability_status"], "offline")
                self.assertFalse(conn.providers["models"]["victim"]["is_online"])
                self.assertEqual(conn.events, ["begin", "commit", "close"])
                self.assertEqual(conn.calls[0][1], ("provider:owner",))
                self.assertTrue(all("FOR UPDATE" in sql for sql, _ in conn.calls if "FROM " in sql))
                self.assertEqual([args[0] for sql, args in conn.calls if sql.startswith("UPDATE ")], ["owner", "owner"])

    async def test_unapproved_kyc_cannot_go_online_even_when_client_claims_approval(self):
        for kyc in [None, "pending", "submitted", "rejected"]:
            with self.subTest(kyc=kyc):
                conn = MemoryConnection(kyc=kyc)
                command = AvailabilityCommand.model_validate({"is_online": True, "kyc_status": "approved"})
                with patch("app.provider_availability.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
                    await set_availability(settings(), command, {"id": "owner", "user_metadata": {"kyc_status": "approved"}})
                self.assertEqual(error.exception.status_code, 403)
                self.assertFalse(any(sql.startswith("UPDATE ") for sql, _ in conn.calls))
                self.assertEqual(conn.events, ["begin", "rollback", "close"])

    async def test_unapproved_provider_can_always_go_offline(self):
        conn = MemoryConnection(kyc="rejected")
        conn.profiles["owner"]["availability_status"] = "online"
        conn.providers["photographers"]["owner"]["is_online"] = True
        with patch("app.provider_availability.connect", new=AsyncMock(return_value=conn)):
            response = await set_availability(settings(), AvailabilityCommand(is_online=False), {"id": "owner"})
        self.assertFalse(response["is_online"])
        self.assertEqual(conn.profiles["owner"]["availability_status"], "offline")
        self.assertFalse(conn.providers["photographers"]["owner"]["is_online"])

    async def test_stored_role_wins_over_all_client_metadata(self):
        for role in ["client", "admin", None, "model; DROP TABLE profiles"]:
            conn = MemoryConnection(role)
            with self.subTest(role=role), patch("app.provider_availability.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
                await set_availability(settings(), AvailabilityCommand(is_online=True), {"id": "owner", "user_metadata": {"role": "model"}})
            self.assertEqual(error.exception.status_code, 403)
            self.assertFalse(any(sql.startswith("UPDATE ") for sql, _ in conn.calls))

    async def test_missing_profiles_fail_without_any_write(self):
        for missing in ["profile", "provider"]:
            conn = MemoryConnection()
            if missing == "profile":
                del conn.profiles["owner"]
            else:
                del conn.providers["photographers"]["owner"]
            with self.subTest(missing=missing), patch("app.provider_availability.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException):
                await set_availability(settings(), AvailabilityCommand(is_online=True), {"id": "owner"})
            self.assertFalse(any(sql.startswith("UPDATE ") for sql, _ in conn.calls))

    async def test_second_write_failure_rolls_back_the_profile_write(self):
        conn = MemoryConnection()
        before = deepcopy((conn.profiles, conn.providers))
        conn.fail_table = "photographers"
        with patch("app.provider_availability.connect", new=AsyncMock(return_value=conn)), self.assertRaises(RuntimeError):
            await set_availability(settings(), AvailabilityCommand(is_online=True), {"id": "owner"})
        self.assertEqual((conn.profiles, conn.providers), before)
        self.assertEqual(conn.events, ["begin", "rollback", "close"])

    async def test_zero_row_or_first_write_failure_rolls_back_everything(self):
        for table, failure in [("profiles", "fail_table"), ("profiles", "zero_table"), ("photographers", "zero_table")]:
            conn = MemoryConnection()
            before = deepcopy((conn.profiles, conn.providers))
            setattr(conn, failure, table)
            with self.subTest(table=table, failure=failure), patch("app.provider_availability.connect", new=AsyncMock(return_value=conn)), self.assertRaises((HTTPException, RuntimeError)):
                await set_availability(settings(), AvailabilityCommand(is_online=True), {"id": "owner"})
            self.assertEqual((conn.profiles, conn.providers), before)
            self.assertEqual(conn.events, ["begin", "rollback", "close"])

    async def test_reads_require_both_flags_and_approved_kyc_to_report_online(self):
        for status, online, kyc, expected in [("online", True, "approved", True), ("offline", True, "approved", False), ("online", False, "approved", False), ("online", True, "pending", False)]:
            conn = MemoryConnection(kyc=kyc)
            conn.profiles["owner"]["availability_status"] = status
            conn.providers["photographers"]["owner"]["is_online"] = online
            with self.subTest(status=status, online=online, kyc=kyc), patch("app.provider_availability.connect", new=AsyncMock(return_value=conn)):
                response = await read_availability(settings(), {"id": "owner"})
            self.assertEqual(response["is_online"], expected)
            self.assertFalse(any(sql.startswith("UPDATE ") for sql, _ in conn.calls))
            self.assertTrue(all("FOR SHARE" in sql for sql, _ in conn.calls if "FROM " in sql))

    async def test_domain_functions_require_auth_before_connecting(self):
        for user in [None, {}, {"id": ""}]:
            for action in ["read", "write"]:
                with self.subTest(user=user, action=action), patch("app.provider_availability.connect", new=AsyncMock()) as connect, self.assertRaises(HTTPException) as error:
                    if action == "read":
                        await read_availability(settings(), user)
                    else:
                        await set_availability(settings(), AvailabilityCommand(is_online=True), user)
                self.assertEqual(error.exception.status_code, 401)
                connect.assert_not_awaited()


class AvailabilityRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_settings] = settings

    def test_both_routes_require_a_valid_bearer_session(self):
        with TestClient(self.app) as client:
            for headers in [{}, {"Authorization": "Basic owner"}]:
                self.assertEqual(client.get("/providers/me/availability", headers=headers).status_code, 401)
                self.assertEqual(client.post("/providers/me/availability", json={"is_online": True}, headers=headers).status_code, 401)
            with patch("app.builtin_functions.require_user", new=AsyncMock(side_effect=HTTPException(status_code=401, detail="Invalid session."))):
                headers = {"Authorization": "Bearer invalid"}
                self.assertEqual(client.get("/providers/me/availability", headers=headers).status_code, 401)
                self.assertEqual(client.post("/providers/me/availability", json={"is_online": True}, headers=headers).status_code, 401)

    def test_write_ignores_spoofed_owner_role_and_kyc_and_updates_only_session_owner(self):
        conn = MemoryConnection("photographer")
        with TestClient(self.app) as client, patch("app.builtin_functions.require_user", new=AsyncMock(return_value={"id": "owner", "role": "model"})) as authenticate, patch("app.provider_availability.connect", new=AsyncMock(return_value=conn)):
            response = client.post("/providers/me/availability?user_id=victim", json={"is_online": True, "user_id": "victim", "role": "model", "kyc_status": "approved"}, headers={"Authorization": "Bearer session"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "photographer")
        self.assertEqual(authenticate.await_args.args[1], "session")
        self.assertFalse(conn.providers["models"]["victim"]["is_online"])
        self.assertTrue(conn.providers["photographers"]["owner"]["is_online"])

    def test_get_ignores_owner_in_query_parameters(self):
        conn = MemoryConnection()
        with TestClient(self.app) as client, patch("app.builtin_functions.require_user", new=AsyncMock(return_value={"id": "owner"})), patch("app.provider_availability.connect", new=AsyncMock(return_value=conn)):
            response = client.get("/providers/me/availability?provider_id=victim", headers={"Authorization": "Bearer session"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([args[0] for sql, args in conn.calls if "FROM " in sql], ["owner", "owner"])

    def test_online_must_be_a_real_boolean(self):
        for value in ["false", "true", 0, 1, None, [], {}]:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                AvailabilityCommand(is_online=value)


if __name__ == "__main__":
    unittest.main()
