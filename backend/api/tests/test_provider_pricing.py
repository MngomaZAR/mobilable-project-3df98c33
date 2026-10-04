import hashlib
import json
import unittest
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.booking_engine import BookingInput, calculate_quote, create_booking, fingerprint, quote_booking, transition_booking
from app.config import Settings, get_settings
from app.provider_settings import ReplaceModelServices, booking_options, replace_model_services, router


def settings():
    return Settings(_env_file=None, DATABASE_URL="postgresql://unused", COMMISSION_RATE=0.2)


def booking(**overrides):
    start = (datetime.now(UTC) + timedelta(days=1)).replace(hour=8, minute=0, second=0, microsecond=0)
    return BookingInput.model_validate({
        "photographer_id": "creator", "package_id": "essential",
        "start_datetime": start, "end_datetime": start + timedelta(hours=1),
        "user_latitude": -29.85, "user_longitude": 31.03, "idempotency_key": "pricing-retry-key",
        **overrides,
    })


def provider(**overrides):
    return {"id": "creator", "latitude": -29.85, "longitude": 31.03, "travel_radius": 50, **overrides}


def service(rate="1800.50", active=True, **overrides):
    return {"service_type": "product_shoot", "rate_zar": Decimal(rate), "is_active": active, "requires_age_verification": False, **overrides}


class PricingTests(unittest.TestCase):
    def test_legacy_photographer_catalogue_without_customization(self):
        self.assertEqual(len(booking_options(provider(), "photographer")["packages"]), 5)
        quote = calculate_quote(settings(), booking(), provider())
        self.assertEqual(quote["total_amount"], Decimal("1400.00"))
        self.assertEqual(quote["price_source"], "catalog")

    def test_configured_tier_restricts_packages(self):
        creator = provider(tier_id="premium")
        options = booking_options(creator, "photographer")
        self.assertEqual([item["id"] for item in options["packages"]], ["premium"])
        with self.assertRaises(HTTPException):
            calculate_quote(settings(), booking(), creator)
        self.assertEqual(calculate_quote(settings(), booking(package_id="premium"), creator)["total_amount"], Decimal("5200.00"))

    def test_published_hourly_rate_overrides_only_published_offer(self):
        creator = provider(hourly_rate=Decimal("1234.50"), tier_id="premium")
        # Use an exact duration independently of the helper's clock reads.
        command = booking(package_id="premium")
        command.end_datetime = command.start_datetime + timedelta(hours=2)
        quote = calculate_quote(settings(), command, creator)
        self.assertEqual(quote["base_amount"], Decimal("2469.00"))
        self.assertEqual(quote["price_source"], "provider_hourly_rate")
        self.assertEqual(booking_options(provider(hourly_rate=900), "photographer")["packages"][0]["id"], "standard")

    def test_zero_rate_is_legacy_unset_not_free(self):
        for value in [0, 0.0, Decimal("0.00")]:
            self.assertEqual(calculate_quote(settings(), booking(), provider(hourly_rate=value))["total_amount"], Decimal("1400.00"))

    def test_invalid_published_rate_or_tier_never_falls_back(self):
        for value in ["NaN", "Infinity", "-1", "100001", "oops", "1.001"]:
            with self.subTest(value=value), self.assertRaises(HTTPException):
                booking_options(provider(hourly_rate=value), "photographer")
        with self.assertRaises(HTTPException):
            booking_options(provider(tier_id="invented"), "photographer")

    def test_equipment_tier_and_published_addons(self):
        creator = provider(tier_id="essential", photographer_equipment={
            "tier_id": "standard", "camera_body": "Mirrorless body", "lenses": '["prime", "zoom", "Unpriced custom lens"]',
            "lighting": "strobes", "extras": ["audio"],
        })
        quote = calculate_quote(settings(), booking(package_id="standard", equipment_selection={
            "camera": ["mirrorless"], "lenses": ["prime", "zoom"], "lighting": ["strobes"], "extras": ["audio"],
        }), creator)
        self.assertEqual(quote["equipment_amount"], Decimal("1110.00"))
        self.assertEqual(quote["total_amount"], Decimal("3310.00"))
        self.assertEqual(quote["commission_amount"], Decimal("662.00"))
        self.assertEqual(quote["payout_amount"], Decimal("2648.00"))

    def test_unknown_unlisted_and_duplicate_equipment_rejected(self):
        for selection in [{"extras": ["invented"]}, {"lenses": ["prime", "prime"]}, {"camera": {"id": "dslr", "price": 1}}, {"price": 1}]:
            with self.subTest(selection=selection), self.assertRaises(ValidationError):
                booking(equipment_selection=selection)
        with self.assertRaises(HTTPException):
            calculate_quote(settings(), booking(equipment_selection={"extras": ["drone"]}), provider())

    def test_free_text_camera_does_not_invent_equipment_availability(self):
        options = booking_options(provider(photographer_equipment={"camera_body": "Sony A7 IV", "lenses": ["Custom lens"]}), "photographer")
        self.assertTrue(all(not values for values in options["equipment"].values()))

    def test_model_service_is_session_priced_without_photo_deliverables(self):
        command = booking(photographer_id=None, model_id="creator", package_id=None, model_service_type="product_shoot")
        command.end_datetime = command.start_datetime + timedelta(hours=3)
        quote = calculate_quote(settings(), command, provider(model_services=[service()]))
        self.assertEqual(quote["base_amount"], Decimal("1800.50"))
        self.assertEqual(quote["commission_amount"], Decimal("360.10"))
        self.assertEqual(quote["payout_amount"], Decimal("1440.40"))
        self.assertEqual(quote["pricing_basis"], "session")
        self.assertIsNone(quote["package_id"])
        self.assertIsNone(quote["edited_images"])
        self.assertIsNone(quote["delivery_days"])

    def test_model_inactive_missing_and_age_restricted_services_do_not_fall_back(self):
        command = booking(photographer_id=None, model_id="creator", model_service_type="product_shoot")
        for services in [[], [service(active=False)], [service(requires_age_verification=True)]]:
            with self.subTest(services=services), self.assertRaises(HTTPException):
                calculate_quote(settings(), command, provider(model_services=services, hourly_rate=500))
        with self.assertRaises(HTTPException):
            calculate_quote(settings(), booking(photographer_id=None, model_id="creator"), provider())

    def test_adult_service_and_cross_creator_selection_rejected(self):
        for change in [{"model_id": "creator", "photographer_id": None, "model_service_type": "adult_content"},
                       {"model_service_type": "product_shoot"},
                       {"model_id": "creator", "photographer_id": None, "equipment_selection": {"lenses": ["prime"]}}]:
            with self.subTest(change=change), self.assertRaises(ValidationError):
                booking(**change)

    def test_client_money_and_price_range_do_not_control_quote(self):
        command = booking(price_total=1, commission_amount=0, payout_amount=99999, rate_zar=1)
        quote = calculate_quote(settings(), command, provider(price_range="$$$$$"))
        self.assertEqual(quote["total_amount"], Decimal("1400.00"))
        self.assertEqual(quote["commission_amount"], Decimal("280.00"))

    def test_video_has_no_published_offer(self):
        with self.assertRaises(HTTPException):
            calculate_quote(settings(), booking(photography_service_type="video"), provider())

    def test_travel_and_commission_round_once_and_reconcile(self):
        with patch("app.booking_engine.distance_km", return_value=1.234):
            quote = calculate_quote(settings(), booking(), provider())
        self.assertEqual(quote["travel_amount"], Decimal("14.81"))
        self.assertEqual(quote["total_amount"], Decimal("1414.81"))
        self.assertEqual(quote["commission_amount"], Decimal("282.96"))
        self.assertEqual(quote["total_amount"], quote["commission_amount"] + quote["payout_amount"])
        with self.assertRaises(HTTPException):
            calculate_quote(settings().model_copy(update={"commission_rate": 1.1}), booking(), provider())

    def test_fingerprint_preserves_pre_migration_retry_hash(self):
        command = booking()
        fields = {"photographer_id", "model_id", "package_id", "start_datetime", "end_datetime", "user_latitude", "user_longitude", "notes", "is_instant"}
        old_body = command.model_dump(mode="json", include=fields)
        old_hash = hashlib.sha256(json.dumps(old_body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(fingerprint(command), old_hash)

    def test_expected_quote_money_has_canonical_retry_fingerprint(self):
        command = booking(expected_total_amount=1400)
        other = BookingInput.model_validate({**command.model_dump(), "expected_total_amount": "1400.00"})
        self.assertEqual(fingerprint(command), fingerprint(other))

    def test_matching_preparation_is_not_a_scheduled_retry(self):
        command = booking()
        self.assertNotEqual(fingerprint(command), fingerprint(command.model_copy(update={'prepare_dispatch': True})))

    def test_fingerprint_includes_selections_not_retry_key_or_order(self):
        command = booking(equipment_selection={"lenses": ["zoom", "prime"]})
        other = BookingInput.model_validate({**command.model_dump(), "idempotency_key": "another-key", "equipment_selection": {"lenses": ["prime", "zoom"]}})
        self.assertEqual(fingerprint(command), fingerprint(other))
        self.assertNotEqual(fingerprint(command), fingerprint(command.model_copy(update={"photography_service_type": "event"})))
        model = booking(photographer_id=None, model_id="creator", model_service_type="product_shoot")
        self.assertNotEqual(fingerprint(model), fingerprint(model.model_copy(update={"model_service_type": "fashion_shoot"})))

    def test_replacement_validates_all_rows_before_writes(self):
        for rate in [0, -1, 100001, "NaN", "Infinity", "1.001", None, True]:
            with self.subTest(rate=rate), self.assertRaises(ValidationError):
                ReplaceModelServices.model_validate({"services": [{"service_type": "product_shoot", "rate_zar": rate}]})
        for payload in [{"model_id": "victim", "services": []},
                        {"services": [{"service_type": "adult_content", "rate_zar": 1}]},
                        {"services": [{"service_type": "product_shoot", "rate_zar": 1, "model_id": "victim"}]},
                        {"services": [{"service_type": "product_shoot", "rate_zar": 1}] * 2}]:
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                ReplaceModelServices.model_validate(payload)


class MemoryTransaction:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        self.before = deepcopy((self.conn.services, self.conn.bookings))
        self.conn.events.append("begin")

    async def __aexit__(self, kind, value, trace):
        if kind:
            self.conn.services, self.conn.bookings = self.before
            self.conn.events.append("rollback")
        else:
            self.conn.events.append("commit")


class MemoryConnection:
    """Domain-test double; PostgreSQL transaction/locking semantics require integration QA."""
    def __init__(self, role="model"):
        self.role = role
        self.verified = True
        self.age_verified = True
        self.has_model = True
        self.accounts = {owner: {"id": owner, "metadata": {}} for owner in ("client", "creator", "victim")}
        self.creator = provider()
        self.gear = None
        self.services = {("creator", "product_shoot"): service(), ("victim", "product_shoot"): service("900")}
        self.bookings = {}
        self.calls = []
        self.events = []
        self.fail_on_service = None

    def transaction(self):
        return MemoryTransaction(self)

    async def close(self):
        self.events.append("close")

    async def execute(self, sql, *args):
        self.calls.append((sql, args))
        if sql.startswith("UPDATE model_services"):
            for (owner, kind), row in self.services.items():
                if owner == args[0]:
                    row["is_active"] = False
        elif sql.startswith("INSERT INTO model_services"):
            identifier, owner, kind, rate = args
            if kind == self.fail_on_service:
                raise RuntimeError("synthetic upsert failure")
            self.services[(owner, kind)] = service(str(rate), service_type=kind)

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        if "FROM api_users" in sql:
            return deepcopy(self.accounts.get(args[0]))
        if "FROM profiles" in sql:
            return {"id": args[0], "role": self.role, "verified": self.verified, "kyc_status": "approved" if self.verified else "pending", "age_verified": self.age_verified}
        if "FROM models" in sql or "FROM photographers" in sql:
            return deepcopy(self.creator) if self.has_model else None
        if "FROM photographer_equipment" in sql:
            return self.gear
        if "FROM availability" in sql:
            return {"start_time": "00:00", "end_time": "23:59"}
        if sql.startswith("SELECT * FROM bookings WHERE client_id"):
            return next((deepcopy(row) for row in self.bookings.values() if row["client_id"] == args[0] and row["idempotency_key"] == args[1]), None)
        if sql.startswith("SELECT * FROM bookings WHERE id"):
            return deepcopy(self.bookings.get(args[0]))
        if sql.startswith("INSERT INTO bookings"):
            keys = ["id", "client_id", "photographer_id", "model_id", "package_id", "package_type", "service_type", "start_datetime", "end_datetime", "booking_date", "user_latitude", "user_longitude", "notes", "total_amount", "commission_amount", "payout_amount", "distance_km", "idempotency_key", "request_fingerprint", "model_service_type", "photography_service_type", "equipment_selection", "pricing_snapshot"]
            row = dict(zip(keys, args))
            row.update(status="pending", payment_status="unpaid", hold_expires_at=datetime.now(UTC) + timedelta(days=1))
            self.bookings[row["id"]] = row
            return deepcopy(row)
        if sql.startswith("UPDATE bookings SET status"):
            self.bookings[args[0]]["status"] = args[1]
            return deepcopy(self.bookings[args[0]])
        raise AssertionError(f"Unexpected query: {sql}")

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        return [deepcopy(row) for (owner, kind), row in self.services.items() if owner == args[0]]

    async def fetchval(self, sql, *args):
        return False


class PersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_booking_quotes_and_creation_require_open_stored_parties(self):
        for function in (quote_booking, create_booking):
            for owner in ("client", "creator"):
                for status in ("pending", "processing", "completed", "missing"):
                    conn = MemoryConnection("photographer")
                    if status == "missing":
                        del conn.accounts[owner]
                    else:
                        conn.accounts[owner]["metadata"]["deletion_status"] = status
                    with self.subTest(function=function.__name__, owner=owner, status=status), patch("app.booking_engine.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
                        await function(settings(), booking(), {"id": "client", "user_metadata": {"deletion_status": "active"}})
                    self.assertEqual(error.exception.status_code, 403)
                    self.assertFalse(conn.bookings)
                    self.assertFalse(any("INSERT INTO job_outbox" in sql for sql, _ in conn.calls))

    async def test_new_acceptance_blocks_closing_parties_but_existing_work_can_finish(self):
        for owner in ("client", "creator"):
            conn = MemoryConnection("photographer")
            with patch("app.booking_engine.connect", new=AsyncMock(return_value=conn)):
                row = await create_booking(settings(), booking(), {"id": "client"})
                conn.accounts[owner]["metadata"]["deletion_status"] = "pending"
                with self.assertRaises(HTTPException) as error:
                    await transition_booking(settings(), row["id"], "accepted", {"id": "creator"})
                self.assertEqual(error.exception.status_code, 403)
                self.assertEqual(conn.bookings[row["id"]]["status"], "pending")
                cancelled = await transition_booking(settings(), row["id"], "cancelled", {"id": "client"})
                self.assertEqual(cancelled["status"], "cancelled")
                existing = conn.bookings[row["id"]]
                existing.update(status="accepted", payment_status="paid", start_datetime=datetime.now(UTC)-timedelta(hours=2), end_datetime=datetime.now(UTC)-timedelta(hours=1))
                progressed = await transition_booking(settings(), row["id"], "in_progress", {"id": "creator"})
                self.assertEqual(progressed["status"], "in_progress")
                completed = await transition_booking(settings(), row["id"], "completed", {"id": "creator"})
                self.assertEqual(completed["status"], "completed")

    async def test_replacement_owns_rows_disables_omitted_and_converges_on_retry(self):
        conn = MemoryConnection()
        conn.services[("creator", "fashion_shoot")] = service(service_type="fashion_shoot")
        command = ReplaceModelServices(services=[{"service_type": "product_shoot", "rate_zar": "2300.25"}])
        with patch("app.provider_settings.connect", new=AsyncMock(return_value=conn)):
            await replace_model_services(settings(), command, {"id": "creator"})
            first = deepcopy(conn.services)
            await replace_model_services(settings(), command, {"id": "creator"})
        self.assertEqual(conn.services, first)
        self.assertEqual(conn.services[("creator", "product_shoot")]["rate_zar"], Decimal("2300.25"))
        self.assertFalse(conn.services[("creator", "fashion_shoot")]["is_active"])
        self.assertTrue(conn.services[("victim", "product_shoot")]["is_active"])
        self.assertEqual(conn.calls[0][1], ("provider:creator",))
        self.assertEqual(conn.events, ["begin", "commit", "close"] * 2)

    async def test_empty_replacement_disables_only_own_services(self):
        conn = MemoryConnection()
        with patch("app.provider_settings.connect", new=AsyncMock(return_value=conn)):
            await replace_model_services(settings(), ReplaceModelServices(services=[]), {"id": "creator"})
        self.assertFalse(conn.services[("creator", "product_shoot")]["is_active"])
        self.assertTrue(conn.services[("victim", "product_shoot")]["is_active"])

    async def test_replacement_rolls_back_reset_and_prior_upsert_on_failure(self):
        conn = MemoryConnection()
        before = deepcopy(conn.services)
        conn.fail_on_service = "fashion_shoot"
        command = ReplaceModelServices(services=[{"service_type": "product_shoot", "rate_zar": 100}, {"service_type": "fashion_shoot", "rate_zar": 200}])
        with patch("app.provider_settings.connect", new=AsyncMock(return_value=conn)), self.assertRaises(RuntimeError):
            await replace_model_services(settings(), command, {"id": "creator"})
        self.assertEqual(conn.services, before)
        self.assertEqual(conn.events, ["begin", "rollback", "close"])

    async def test_replacement_checks_database_role_and_model_profile(self):
        for role, has_model in [("client", True), ("photographer", True), ("model", False)]:
            conn = MemoryConnection(role)
            conn.has_model = has_model
            with patch("app.provider_settings.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException):
                await replace_model_services(settings(), ReplaceModelServices(services=[]), {"id": "creator", "user_metadata": {"role": "model"}})
            self.assertFalse(any(sql.startswith("UPDATE model_services") for sql, args in conn.calls))

    async def test_domain_functions_require_authenticated_actor(self):
        for function, command in [(replace_model_services, ReplaceModelServices(services=[])), (create_booking, booking()), (quote_booking, booking())]:
            with self.subTest(function=function.__name__), self.assertRaises(HTTPException) as error:
                await function(settings(), command, None)
            self.assertEqual(error.exception.status_code, 401)

    async def test_quotes_enforce_verification_and_self_booking(self):
        for field in ["verified", "age_verified"]:
            conn = MemoryConnection("photographer")
            setattr(conn, field, False)
            with patch("app.booking_engine.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException):
                await quote_booking(settings(), booking(), {"id": "client"})
        with self.assertRaises(HTTPException):
            await quote_booking(settings(), booking(), {"id": "creator"})

    async def test_booking_saves_service_snapshot_and_replays_after_changes_or_start(self):
        conn = MemoryConnection()
        command = booking(photographer_id=None, model_id="creator", package_id=None, model_service_type="product_shoot", expected_total_amount="1800.50")
        with patch("app.booking_engine.connect", new=AsyncMock(return_value=conn)):
            row = await create_booking(settings(), command, {"id": "client"})
            conn.services[("creator", "product_shoot")] = service("9999", active=False)
            conn.verified = False
            with patch("app.booking_engine.datetime") as clock:
                clock.now.return_value = command.end_datetime + timedelta(days=1)
                replay = await create_booking(settings(), command, {"id": "client"})
        self.assertEqual(row, replay)
        snapshot = json.loads(row["pricing_snapshot"])
        self.assertEqual(snapshot["unit_rate"], "1800.50")
        self.assertEqual(snapshot["total_amount"], "1800.50")
        self.assertEqual(snapshot["commission_amount"], "360.10")
        self.assertEqual(row["model_service_type"], "product_shoot")
        self.assertEqual(row["client_id"], "client")
        self.assertEqual(sum(sql.startswith("INSERT INTO bookings") for sql, args in conn.calls), 1)

    async def test_photographer_snapshot_retains_addon_and_commission(self):
        conn = MemoryConnection("photographer")
        conn.gear = {"tier_id": "standard", "extras": ["audio"]}
        with patch("app.booking_engine.connect", new=AsyncMock(return_value=conn)):
            row = await create_booking(settings(), booking(package_id="standard", equipment_selection={"extras": ["audio"]}, expected_total_amount=2400), {"id": "client"})
        snapshot = json.loads(row["pricing_snapshot"])
        self.assertEqual(snapshot["equipment_amount"], "200.00")
        self.assertEqual(snapshot["commission_amount"], "480.00")
        self.assertEqual(json.loads(row["equipment_selection"])["extras"], ["audio"])

    async def test_reusing_retry_key_with_new_selection_conflicts(self):
        conn = MemoryConnection()
        command = booking(photographer_id=None, model_id="creator", model_service_type="product_shoot")
        with patch("app.booking_engine.connect", new=AsyncMock(return_value=conn)):
            await create_booking(settings(), command, {"id": "client"})
            with self.assertRaises(HTTPException) as error:
                await create_booking(settings(), command.model_copy(update={"model_service_type": "fashion_shoot"}), {"id": "client"})
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(len(conn.bookings), 1)

    async def test_changed_quote_is_rejected_without_booking_or_outbox(self):
        conn = MemoryConnection("photographer")
        with patch("app.booking_engine.connect", new=AsyncMock(return_value=conn)), self.assertRaises(HTTPException) as error:
            await create_booking(settings(), booking(expected_total_amount=1), {"id": "client"})
        self.assertEqual(error.exception.status_code, 409)
        self.assertFalse(conn.bookings)
        self.assertFalse(any("INSERT INTO job_outbox" in sql for sql, args in conn.calls))

    async def test_acceptance_does_not_reprice_removed_service(self):
        conn = MemoryConnection()
        command = booking(photographer_id=None, model_id="creator", model_service_type="product_shoot")
        with patch("app.booking_engine.connect", new=AsyncMock(return_value=conn)):
            row = await create_booking(settings(), command, {"id": "client"})
            conn.services.clear()
            accepted = await transition_booking(settings().model_copy(update={"commission_rate": 0.3}), row["id"], "accepted", {"id": "creator"})
        self.assertEqual(accepted["pricing_snapshot"], row["pricing_snapshot"])
        self.assertEqual(accepted["total_amount"], row["total_amount"])
        self.assertEqual(accepted["status"], "accepted")

    async def test_acceptance_reconstructs_equipment_without_changing_hash_or_snapshot(self):
        conn = MemoryConnection("photographer")
        conn.gear = {"tier_id": "standard", "extras": ["audio"]}
        command = booking(package_id="standard", photography_service_type="event", equipment_selection={"extras": ["audio"]}, expected_total_amount=2400)
        with patch("app.booking_engine.connect", new=AsyncMock(return_value=conn)):
            row = await create_booking(settings(), command, {"id": "client"})
            conn.gear = None
            conn.creator["hourly_rate"] = 9999
            accepted = await transition_booking(settings(), row["id"], "accepted", {"id": "creator"})
        for field in ["request_fingerprint", "pricing_snapshot", "equipment_selection", "photography_service_type", "total_amount", "commission_amount"]:
            self.assertEqual(accepted[field], row[field])
        self.assertEqual(accepted["status"], "accepted")


class ProviderRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_settings] = settings

    def test_both_routes_require_authentication(self):
        with TestClient(self.app) as client, patch("app.builtin_functions.require_user", new=AsyncMock(side_effect=HTTPException(status_code=401, detail="Authentication is required."))):
            self.assertEqual(client.post("/providers/me/model-services", json={"services": []}).status_code, 401)
            self.assertEqual(client.get("/providers/creator/booking-options").status_code, 401)

    def test_route_cannot_supply_another_owner_and_passes_session_identity(self):
        replace = AsyncMock(return_value={"services": []})
        with TestClient(self.app) as client, patch("app.builtin_functions.require_user", new=AsyncMock(return_value={"id": "creator"})), patch("app.provider_settings.replace_model_services", new=replace):
            self.assertEqual(client.post("/providers/me/model-services", json={"services": [], "model_id": "victim"}).status_code, 422)
            self.assertEqual(client.post("/providers/me/model-services", json={"services": []}, headers={"Authorization": "Bearer session"}).status_code, 200)
        self.assertEqual(replace.await_args.args[2], {"id": "creator"})

    def test_options_use_only_published_non_adult_services(self):
        conn = MemoryConnection()
        conn.services[("creator", "adult_content")] = service(service_type="adult_content")
        conn.services[("creator", "fashion_shoot")] = service(active=False, service_type="fashion_shoot")
        with TestClient(self.app) as client, patch("app.builtin_functions.require_user", new=AsyncMock(return_value={"id": "client"})), patch("app.provider_settings.connect", new=AsyncMock(return_value=conn)):
            response = client.get("/providers/creator/booking-options")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.json()["services"]], ["product_shoot"])
        self.assertFalse(response.json()["packages"])


if __name__ == "__main__":
    unittest.main()
