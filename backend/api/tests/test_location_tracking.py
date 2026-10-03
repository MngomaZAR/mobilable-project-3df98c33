import math
import unittest
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.location_tracking import (
    LOCATION_TTL, LocationInput, get_booking_locations, router, tracking_window,
    update_booking_location, update_provider_location,
)


NOW = datetime(2026, 10, 3, 10, tzinfo=UTC)


def settings():
    return Settings(_env_file=None, DATABASE_URL="postgresql://unused", ADMIN_USER_IDS="server-admin")


def fix(**overrides):
    return LocationInput(latitude=-29.85, longitude=31.03, accuracy_m=15, **overrides)


def booking(**overrides):
    return {"id": "shoot", "client_id": "client", "photographer_id": "creator", "model_id": None,
            "status": "accepted", "payment_status": "paid", "start_datetime": NOW + timedelta(minutes=30),
            "end_datetime": NOW + timedelta(minutes=90), "user_latitude": -30.0, "user_longitude": 30.0,
            "provider_latitude": None, "provider_longitude": None, **overrides}


def track(user="client", role="client", created=NOW, **overrides):
    return {"id": "fix", "booking_id": "shoot", "user_id": user, "role": role, "latitude": -29.85,
            "longitude": 31.03, "accuracy_m": Decimal("15.00"), "source": "app", "created_at": created, **overrides}


class MemoryTransaction:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        self.before = deepcopy((self.conn.booking, self.conn.tracks))
        self.conn.events.append("begin")

    async def __aexit__(self, kind, value, trace):
        if kind:
            self.conn.booking, self.conn.tracks = self.before
            self.conn.events.append("rollback")
        else:
            self.conn.events.append("commit")


class MemoryConnection:
    """Checks command wiring and filtering; not a substitute for PostgreSQL concurrency QA."""
    def __init__(self, **overrides):
        self.booking = booking(**overrides)
        self.profiles = {
            "client": {"role": "client", "kyc_status": "pending", "age_verified": False},
            "creator": {"role": "photographer", "kyc_status": "approved", "age_verified": True},
        }
        self.creator_exists = True
        self.tracks = []
        self.calls = []
        self.events = []
        self.fail_insert = False

    def transaction(self):
        return MemoryTransaction(self)

    async def close(self):
        self.events.append("close")

    async def execute(self, sql, *args):
        self.calls.append((sql, args))
        if sql.startswith("UPDATE bookings"):
            prefix = "provider" if "provider_latitude" in sql else "user"
            self.booking[f"{prefix}_latitude"], self.booking[f"{prefix}_longitude"] = args[1:3]
            self.booking["updated_at"] = args[3]
            return "UPDATE 1"
        raise AssertionError(f"Unexpected write: {sql}")

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        if "FROM bookings" in sql:
            return deepcopy(self.booking) if self.booking and args[0] == self.booking["id"] else None
        if "FROM profiles" in sql:
            return deepcopy(self.profiles.get(args[0]))
        if "FROM photographers" in sql or "FROM models" in sql:
            return {"id": args[0]} if self.creator_exists else None
        if sql.startswith("INSERT INTO location_tracks"):
            if self.fail_insert:
                raise RuntimeError("synthetic track failure")
            keys = ["id", "booking_id", "user_id", "role", "latitude", "longitude", "accuracy_m", "created_at"]
            row = {**dict(zip(keys, args)), "source": "app"}
            self.tracks.append(row)
            return deepcopy(row)
        raise AssertionError(f"Unexpected query: {sql}")

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        booking_id, client, provider, cutoff, opens, now = args
        rows = [row for row in self.tracks if row["booking_id"] == booking_id
                and ((row["role"] == "client" and row["user_id"] == client) or (row["role"] == "provider" and row["user_id"] == provider))
                and row["source"] == "app" and cutoff < row["created_at"] <= now and row["created_at"] >= opens
                and -35 <= row["latitude"] <= -22 and 16 <= row["longitude"] <= 33
                and math.isfinite(float(row["accuracy_m"])) and 0 < row["accuracy_m"] <= 100]
        latest = {}
        for row in sorted(rows, key=lambda item: (item["created_at"], item["id"])):
            latest[row["role"]] = deepcopy(row)
        return list(latest.values())


class ValidationTests(unittest.TestCase):
    def test_operational_bounds_and_finite_numbers(self):
        for latitude, longitude in [(-35, 16), (-22, 33), (-33.9249, 18.4241)]:
            self.assertEqual(LocationInput(latitude=latitude, longitude=longitude, accuracy_m=1).latitude, latitude)
        for field, value in [("latitude", -35.01), ("latitude", -21.99), ("longitude", 15.99), ("longitude", 33.01),
                             ("latitude", float("nan")), ("longitude", float("inf")), ("latitude", float("-inf")),
                             ("latitude", "-29.85"), ("latitude", True)]:
            with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                LocationInput.model_validate({"latitude": -29.85, "longitude": 31.03, "accuracy_m": 10, field: value})

    def test_accuracy_is_required_positive_finite_and_at_most_100(self):
        for value in [None, 0, -1, 100.01, float("inf"), float("nan"), True, "15"]:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                LocationInput(latitude=-29.85, longitude=31.03, accuracy_m=value)
        with self.assertRaises(ValidationError):
            LocationInput(latitude=-29.85, longitude=31.03)
        self.assertEqual(LocationInput(latitude=-29.85, longitude=31.03, accuracy_m=100).accuracy_m, 100)

    def test_owner_role_source_timestamp_and_booking_cannot_be_spoofed(self):
        for field, value in [("user_id", "victim"), ("role", "provider"), ("source", "server"),
                             ("created_at", NOW.isoformat()), ("expires_at", NOW.isoformat()), ("booking_id", "other")]:
            with self.subTest(field=field), self.assertRaises(ValidationError):
                LocationInput.model_validate({"latitude": -29.85, "longitude": 31.03, "accuracy_m": 15, field: value})

    def test_tracking_requires_paid_accepted_or_in_progress(self):
        for status in ["pending", "declined", "cancelled", "completed"]:
            with self.subTest(status=status), self.assertRaises(HTTPException):
                tracking_window(booking(status=status), NOW)
        for payment in ["unpaid", "refunded", "complete", None]:
            with self.subTest(payment=payment), self.assertRaises(HTTPException):
                tracking_window(booking(payment_status=payment), NOW)
        for status in ["accepted", "in_progress"]:
            self.assertEqual(tracking_window(booking(status=status), NOW)[1], booking()["end_datetime"])

    def test_travel_window_is_two_hours_before_start_until_scheduled_end(self):
        row = booking()
        opens = row["start_datetime"] - timedelta(hours=2)
        for now in [opens, row["start_datetime"], row["end_datetime"] - timedelta(microseconds=1)]:
            self.assertEqual(tracking_window(row, now), (opens, row["end_datetime"]))
        for now in [opens - timedelta(microseconds=1), row["end_datetime"], row["end_datetime"] + timedelta(days=1)]:
            with self.subTest(now=now), self.assertRaises(HTTPException):
                tracking_window(row, now)

    def test_invalid_naive_missing_or_excessive_schedule_denied(self):
        for change in [{"start_datetime": None}, {"end_datetime": "later"},
                       {"start_datetime": NOW.replace(tzinfo=None)}, {"end_datetime": NOW},
                       {"end_datetime": NOW + timedelta(days=10)}]:
            with self.subTest(change=change), self.assertRaises(HTTPException):
                tracking_window(booking(**change), NOW)


class LocationCommandTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.clock = patch("app.location_tracking.utc_now", return_value=NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)

    async def test_client_coordinates_and_track_are_one_transaction(self):
        conn = MemoryConnection()
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)):
            result = await update_booking_location(settings(), "shoot", fix(), {"id": "client", "user_metadata": {"role": "provider"}})
        self.assertEqual(conn.booking["user_latitude"], -29.85)
        self.assertIsNone(conn.booking["provider_latitude"])
        self.assertEqual(result["location"]["role"], "client")
        self.assertEqual(result["location"]["user_id"], "client")
        self.assertEqual(result["location"]["expires_at"], NOW + LOCATION_TTL)
        self.assertEqual(conn.events, ["begin", "commit", "close"])
        self.assertIn("FOR UPDATE", conn.calls[0][0])

    async def test_photographer_coordinates_are_booking_private(self):
        conn = MemoryConnection()
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)):
            result = await update_booking_location(settings(), "shoot", fix(), {"id": "creator"})
        self.assertEqual(conn.booking["provider_latitude"], -29.85)
        self.assertEqual(conn.booking["user_latitude"], -30)
        self.assertEqual(result["provider_type"], "photographer")
        self.assertEqual(result["location"]["role"], "provider")
        self.assertFalse(any(sql.startswith("UPDATE photographers") or sql.startswith("UPDATE models") for sql, args in conn.calls))

    async def test_booked_model_uses_stored_model_role(self):
        conn = MemoryConnection(photographer_id=None, model_id="creator")
        conn.profiles["creator"]["role"] = "model"
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)):
            result = await update_booking_location(settings(), "shoot", fix(), {"id": "creator", "user_metadata": {"role": "photographer"}})
        self.assertEqual(result["provider_type"], "model")
        self.assertTrue(any("FROM models" in sql for sql, args in conn.calls))

    async def test_creator_role_must_match_booking_and_not_metadata(self):
        for role in ["client", "model"]:
            conn = MemoryConnection()
            conn.profiles["creator"]["role"] = role
            with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
                await update_booking_location(settings(), "shoot", fix(), {"id": "creator", "user_metadata": {"role": "photographer"}})
            self.assertEqual(error.exception.status_code, 403)
            self.assertFalse(conn.tracks)

    async def test_outsiders_and_server_admin_cannot_write_for_participants(self):
        for user in [{"id": "outsider"}, {"id": "server-admin"}, {"id": "outsider", "user_metadata": {"role": "admin"}}]:
            conn = MemoryConnection()
            with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
                await update_booking_location(settings(), "shoot", fix(), user)
            self.assertEqual(error.exception.status_code, 403)
            self.assertFalse(conn.tracks)
            self.assertFalse(any(sql.startswith("UPDATE") for sql, args in conn.calls))

    async def test_payment_status_and_window_deny_reads_and_writes(self):
        for change in [{"payment_status": "unpaid"}, {"payment_status": "refunded"}, {"status": "pending"},
                       {"status": "completed"}, {"status": "cancelled"},
                       {"start_datetime": NOW + timedelta(hours=3), "end_datetime": NOW + timedelta(hours=4)},
                       {"start_datetime": NOW - timedelta(hours=2), "end_datetime": NOW}]:
            for function in [update_booking_location, get_booking_locations]:
                conn = MemoryConnection(**change)
                args = (settings(), "shoot", fix(), {"id": "client"}) if function == update_booking_location else (settings(), "shoot", {"id": "client"})
                with self.subTest(change=change, function=function.__name__), patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
                    await function(*args)
                self.assertEqual(error.exception.status_code, 409)
                self.assertFalse(conn.tracks)
                self.assertFalse(any(sql.startswith("UPDATE") for sql, values in conn.calls))

    async def test_track_failure_rolls_back_client_and_provider_coordinates(self):
        for user in ["client", "creator"]:
            conn = MemoryConnection()
            before = deepcopy(conn.booking)
            conn.fail_insert = True
            with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)), self.assertRaises(RuntimeError):
                await update_booking_location(settings(), "shoot", fix(), {"id": user})
            self.assertEqual(conn.booking, before)
            self.assertFalse(conn.tracks)
            self.assertEqual(conn.events, ["begin", "rollback", "close"])

    async def test_all_commands_require_authenticated_actor(self):
        for function, args in [(update_booking_location, (settings(), "shoot", fix(), None)),
                               (get_booking_locations, (settings(), "shoot", None)),
                               (update_provider_location, (settings(), fix(), None))]:
            with self.subTest(function=function.__name__), self.assertRaises(HTTPException) as error:
                await function(*args)
            self.assertEqual(error.exception.status_code, 401)

    async def test_missing_booking_is_404(self):
        conn = MemoryConnection()
        for function, args in [(get_booking_locations, (settings(), "missing", {"id": "client"})),
                               (update_booking_location, (settings(), "missing", fix(), {"id": "client"}))]:
            with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
                await function(*args)
            self.assertEqual(error.exception.status_code, 404)

    async def test_standalone_current_fix_is_private_and_requires_verified_stored_role(self):
        for role in ["photographer", "model"]:
            conn = MemoryConnection()
            conn.profiles["creator"]["role"] = role
            with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)):
                result = await update_provider_location(settings(), fix(), {"id": "creator", "user_metadata": {"role": "client"}})
            self.assertEqual(result["provider_type"], role)
            self.assertIsNone(result["location"]["booking_id"])
            self.assertEqual(result["location"]["expires_at"], NOW + LOCATION_TTL)
            self.assertFalse(any(sql.startswith("UPDATE") for sql, args in conn.calls))

    async def test_standalone_rejects_client_role_kyc_bypass_and_missing_creator(self):
        for change in [{"role": "client"}, {"kyc_status": "pending"}, {"kyc_status": "rejected", "verified": True}, {"age_verified": False}]:
            conn = MemoryConnection()
            conn.profiles["creator"].update(change)
            with self.subTest(change=change), patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
                await update_provider_location(settings(), fix(), {"id": "creator", "user_metadata": {"role": "model", "kyc_status": "approved"}})
            self.assertEqual(error.exception.status_code, 403)
            self.assertFalse(conn.tracks)
        conn = MemoryConnection()
        conn.creator_exists = False
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
            await update_provider_location(settings(), fix(), {"id": "creator"})
        self.assertEqual(error.exception.status_code, 409)

    async def test_provider_booking_also_requires_current_kyc(self):
        conn = MemoryConnection()
        conn.profiles["creator"]["kyc_status"] = "rejected"
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException):
            await update_booking_location(settings(), "shoot", fix(), {"id": "creator"})
        self.assertFalse(conn.tracks)

    async def test_accuracy_is_rounded_conservatively_not_to_zero(self):
        conn = MemoryConnection()
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)):
            result = await update_provider_location(settings(), LocationInput(latitude=-29.85, longitude=31.03, accuracy_m=0.001), {"id": "creator"})
        self.assertEqual(result["location"]["accuracy_m"], 0.01)

    async def test_read_only_participants_and_allowlisted_admin(self):
        conn = MemoryConnection()
        conn.tracks = [track(), track("creator", "provider")]
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)):
            for actor in ["client", "creator", "server-admin"]:
                result = await get_booking_locations(settings(), "shoot", {"id": actor})
                self.assertEqual({row["role"] for row in result["locations"]}, {"client", "provider"})
            for actor in [{"id": "outsider"}, {"id": "outsider", "user_metadata": {"role": "admin"}}]:
                with self.assertRaises(HTTPException) as error:
                    await get_booking_locations(settings(), "shoot", actor)
                self.assertEqual(error.exception.status_code, 403)

    async def test_reader_receives_only_latest_fresh_correctly_attributed_fixes(self):
        conn = MemoryConnection()
        conn.tracks = [track(created=NOW - timedelta(minutes=1), latitude=-30), track(id="latest"), track("creator", "provider"),
                       track(created=NOW - LOCATION_TTL), track(created=NOW + timedelta(seconds=1)),
                       track("outsider", "provider"), track("creator", "client"), track(booking_id="another-shoot"),
                       track(booking_id=None), track(source="spoof"), track(latitude=float("nan")),
                       track(longitude=15), track(accuracy_m=Decimal("101"))]
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)):
            result = await get_booking_locations(settings(), "shoot", {"id": "client"})
        self.assertEqual(len(result["locations"]), 2)
        self.assertTrue(all(row["latitude"] == -29.85 for row in result["locations"]))
        sql, args = next((sql, args) for sql, args in conn.calls if "SELECT DISTINCT ON" in sql)
        self.assertIn("user_id=$2", sql)
        self.assertIn("user_id=$3", sql)
        self.assertEqual(args[:3], ("shoot", "client", "creator"))
        self.assertEqual(args[3], NOW - LOCATION_TTL)

    async def test_expired_fix_returns_no_fallback_coordinates(self):
        conn = MemoryConnection()
        conn.tracks = [track(created=NOW - LOCATION_TTL)]
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)):
            result = await get_booking_locations(settings(), "shoot", {"id": "client"})
        self.assertEqual(result["locations"], [])
        self.assertNotIn("user_latitude", result)
        self.assertNotIn("provider_latitude", result)

    async def test_fix_cannot_precede_travel_window_and_expiry_caps_at_booking_end(self):
        conn = MemoryConnection(start_datetime=NOW + timedelta(hours=2), end_datetime=NOW + timedelta(hours=3))
        conn.tracks = [track(created=NOW - timedelta(seconds=1))]
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)):
            self.assertEqual((await get_booking_locations(settings(), "shoot", {"id": "client"}))["locations"], [])
        conn = MemoryConnection(end_datetime=NOW + timedelta(minutes=1), start_datetime=NOW - timedelta(minutes=30))
        with patch("app.location_tracking.connect", new=AsyncMock(return_value=conn)):
            result = await update_booking_location(settings(), "shoot", fix(), {"id": "client"})
        self.assertEqual(result["location"]["expires_at"], conn.booking["end_datetime"])


class LocationRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_settings] = settings

    def test_routes_require_authentication(self):
        with TestClient(self.app) as client, patch("app.builtin_functions.require_user", new=AsyncMock(side_effect=HTTPException(status_code=401, detail="Authentication is required."))):
            body = {"latitude": -29.85, "longitude": 31.03, "accuracy_m": 15}
            self.assertEqual(client.post("/bookings/shoot/location", json=body).status_code, 401)
            self.assertEqual(client.get("/bookings/shoot/location").status_code, 401)
            self.assertEqual(client.post("/providers/me/location", json=body).status_code, 401)

    def test_routes_reject_spoofed_fields_and_missing_or_poor_accuracy(self):
        command = AsyncMock(return_value={"location": {}})
        with TestClient(self.app) as client, patch("app.builtin_functions.require_user", new=AsyncMock(return_value={"id": "client"})), patch("app.location_tracking.update_booking_location", new=command):
            for extra in [{"user_id": "victim"}, {"role": "provider"}, {"booking_id": "other"}, {"accuracy_m": 101}]:
                body = {"latitude": -29.85, "longitude": 31.03, "accuracy_m": 15, **extra}
                self.assertEqual(client.post("/bookings/shoot/location", json=body).status_code, 422)
            self.assertEqual(client.post("/bookings/shoot/location", json={"latitude": -29.85, "longitude": 31.03}).status_code, 422)
        command.assert_not_awaited()

    def test_route_passes_only_session_identity_and_path_booking(self):
        command = AsyncMock(return_value={"location": {"role": "client"}})
        with TestClient(self.app) as client, patch("app.builtin_functions.require_user", new=AsyncMock(return_value={"id": "client"})), patch("app.location_tracking.update_booking_location", new=command):
            response = client.post("/bookings/shoot/location", json={"latitude": -29.85, "longitude": 31.03, "accuracy_m": 15})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(command.await_args.args[1], "shoot")
        self.assertEqual(command.await_args.args[3], {"id": "client"})


if __name__ == "__main__":
    unittest.main()
