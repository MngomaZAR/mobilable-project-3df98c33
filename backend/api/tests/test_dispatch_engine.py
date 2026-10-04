import asyncio
import json
import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import asyncpg
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import dispatch_engine as engine
from app.config import Settings, get_settings
from app.booking_engine import ZA_TIME
from app.dispatch_engine import DispatchCreate, DispatchRespond

try:
    from .dispatch_protocol import DatabaseCase, loopback_database
except ImportError:
    from dispatch_protocol import DatabaseCase, loopback_database


class DispatchValidationTests(unittest.TestCase):
    def test_existing_payload_defaults_and_nonadult_single_service(self):
        command = DispatchCreate(booking_id="booking", fanout_count=3, intensity_level=2)
        self.assertEqual(command.sla_timeout_seconds, 90)
        for extra in ({"service_type": "combined"}, {"service_type": "video_call"}, {"provider_id": "forged"},
                      {"client_id": "forged"}, {"fanout_count": True}, {"fanout_count": 21},
                      {"intensity_level": 0}, {"intensity_level": 6}, {"sla_timeout_seconds": 301},
                      {"requested_lat": -29.85}, {"requested_lat": float("nan"), "requested_lng": 31.03},
                      {"required_tier": "fictional"}, {"required_equipment": {"camera": ["invented"]}}):
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                DispatchCreate.model_validate({"booking_id": "b", "fanout_count": 3, "intensity_level": 1, **extra})

    def test_no_duration_free_or_forged_response_payload(self):
        with self.assertRaises(ValidationError):
            DispatchCreate(fanout_count=3, intensity_level=1)
        with self.assertRaises(ValidationError):
            DispatchRespond(dispatch_request_id="r", response="accept", provider_id="victim")

    def test_finite_operational_coordinates(self):
        self.assertTrue(engine.in_service_region(-29.85, 31.03))
        for lat, lng in ((None, 31), (float("nan"), 31), (-29, float("inf")), (0, 0), (-36, 31)):
            self.assertFalse(engine.in_service_region(lat, lng))

    def test_protocol_harness_refuses_nonlocal_databases(self):
        for url in ("postgresql://example.invalid/db", "https://127.0.0.1/db", "postgresql:///db"):
            with self.assertRaises(ValueError):
                loopback_database(url)
        self.assertEqual(loopback_database("postgresql://protocol@127.0.0.1:1234/postgres"), "postgresql://protocol@127.0.0.1:1234/postgres")

    def test_client_base_amount_cannot_change_fingerprint(self):
        first = DispatchCreate(booking_id="b", fanout_count=3, intensity_level=1, base_amount=1)
        second = first.model_copy(update={"base_amount": Decimal("999999")})
        self.assertEqual(engine.request_fingerprint(first), engine.request_fingerprint(second))

    def test_router_requires_auth_without_importing_main(self):
        app = FastAPI()
        app.include_router(engine.router)
        app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
        client = TestClient(app)
        self.assertEqual(client.post("/dispatch/requests", json={"booking_id": "b", "fanout_count": 1, "intensity_level": 1}).status_code, 401)
        self.assertEqual(client.get("/dispatch/requests/r").status_code, 401)
        self.assertEqual(client.post("/dispatch/respond", json={"dispatch_request_id": "r", "response": "accept"}).status_code, 401)


class AccountGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_authoritative_metadata_and_missing_account(self):
        for status in ("pending", "processing", "completed"):
            conn = AsyncMock()
            conn.fetchrow.return_value = {"id": "actor", "metadata": json.dumps({"deletion_status": status})}
            with self.subTest(status=status), self.assertRaises(HTTPException) as error:
                await engine.require_open_account(conn, "actor")
            self.assertEqual(error.exception.status_code, 403)
            self.assertIn("FOR SHARE", conn.fetchrow.call_args.args[0])
        conn.fetchrow.return_value = None
        with self.assertRaises(HTTPException):
            await engine.require_open_account(conn, "actor")
        conn.fetchrow.return_value = {"id": "wrong-actor", "metadata": {}}
        with self.assertRaises(HTTPException):
            await engine.require_open_account(conn, "actor")
        conn.fetchrow.return_value = {"id": "actor", "metadata": {}}
        await engine.require_open_account(conn, "actor")


class DispatchDatabaseTests(DatabaseCase):
    async def test_prepared_mobile_booking_only_accepts_through_its_matching_offer(self):
        from app.booking_engine import transition_booking
        booking = await self.pending(prepare_dispatch=True)
        self.assertTrue(booking['is_instant'])
        self.assertEqual((await self.row("SELECT count(*) AS n FROM job_outbox WHERE kind='notification'"))['n'], 0)
        with self.assert_http(409):
            await transition_booking(self.settings, booking['id'], 'accepted', {'id': 'p1'})
        result = await engine.create_dispatch(self.settings,
            DispatchCreate(booking_id=booking['id'], fanout_count=2, intensity_level=1), {'id': 'client'})
        actor = result['offers'][0]['provider_id']
        await self.respond(result, actor)
        saved = await self.row('SELECT * FROM bookings WHERE id=$1', booking['id'])
        self.assertEqual(saved['status'], 'accepted')
        self.assertEqual(saved['payment_status'], 'unpaid')
        self.assertEqual(saved['assignment_state'], 'accepted')

    async def respond(self, result, actor, response="accept", **extra):
        return await engine.respond_to_dispatch(self.settings, DispatchRespond(dispatch_request_id=result["dispatch_request"]["id"], response=response, **extra), {"id": actor})

    async def test_authoritative_ceiling_no_surge_and_private_response(self):
        booking, _, result = await self.dispatched(base_amount=1, required_tier="standard")
        self.assertEqual(result["quote"]["total_amount"], Decimal("1400.00"))
        self.assertEqual(result["quote"]["surge_multiplier"], 1)
        self.assertEqual(result["quote"]["intensity_multiplier"], 1)
        self.assertEqual(result["eta_confidence"], 0)
        self.assertEqual(len(result["offers"]), 4)
        self.assertNotIn("booking_snapshot", result["dispatch_request"])
        self.assertNotIn("request_fingerprint", result["dispatch_request"])
        self.assertTrue(all("latitude" not in offer and "pricing_snapshot" not in offer for offer in result["offers"]))
        row = await self.row("SELECT count(*) AS count FROM job_outbox WHERE dedupe_key LIKE 'dispatch:%' AND kind='notification'")
        self.assertEqual(row["count"], 4)
        payload = json.loads((await self.row("SELECT payload FROM job_outbox WHERE dedupe_key LIKE 'dispatch:%' LIMIT 1"))["payload"])
        self.assertEqual(payload["booking_id"], booking["id"])
        self.assertIn("offer_id", payload)
        self.assertIn("dispatch_request_id", payload)

    async def test_create_race_and_retries_are_one_request(self):
        booking = await self.pending()
        command = DispatchCreate(booking_id=booking["id"], fanout_count=3, intensity_level=2)
        results = await asyncio.gather(*(engine.create_dispatch(self.settings, command, {"id": "client"}) for _ in range(4)))
        self.assertEqual(len({result["dispatch_request"]["id"] for result in results}), 1)
        self.assertEqual((await self.row("SELECT count(*) AS n FROM dispatch_offers"))["n"], 3)
        with self.assert_http(409):
            await engine.create_dispatch(self.settings, command.model_copy(update={"fanout_count": 2}), {"id": "client"})
        retried = await engine.create_dispatch(self.settings, command.model_copy(update={"base_amount": Decimal("9999")}), {"id": "client"})
        self.assertEqual(retried["dispatch_request"]["id"], results[0]["dispatch_request"]["id"])

    async def test_requester_permissions_and_own_offer_visibility(self):
        booking, command, result = await self.dispatched()
        for actor in ("outsider", "p1"):
            with self.assert_http(403):
                await engine.create_dispatch(self.settings, command, {"id": actor, "is_admin": True})
        with self.assert_http(403):
            await self.respond(result, "client")
        with self.assert_http(403):
            await self.respond(result, "p2", offer_id=next(item["id"] for item in result["offers"] if item["provider_id"] == "p1"))
        with self.assert_http(403):
            await engine.get_dispatch_state(self.settings, result["dispatch_request"]["id"], {"id": "outsider", "is_admin": True})
        state = await engine.get_dispatch_state(self.settings, result["dispatch_request"]["id"], {"id": "p2"})
        self.assertEqual([offer["provider_id"] for offer in state["offers"]], ["p2"])

    async def test_first_winner_race_and_response_retry(self):
        booking, _, result = await self.dispatched()
        outcomes = await asyncio.gather(self.respond(result, "p1", idempotency_key="p1-accept-key"), self.respond(result, "p2", idempotency_key="p2-accept-key"), return_exceptions=True)
        accepted = [outcome for outcome in outcomes if isinstance(outcome, dict)]
        errors = [outcome for outcome in outcomes if isinstance(outcome, HTTPException)]
        self.assertEqual(len(accepted), 1)
        self.assertEqual([error.status_code for error in errors], [409])
        winner = accepted[0]["offer"]["provider_id"]
        row = await self.row("SELECT * FROM bookings WHERE id=$1", booking["id"])
        self.assertEqual(row["photographer_id"], winner)
        self.assertEqual(row["status"], "accepted")
        self.assertEqual(row["payment_status"], "unpaid")
        self.assertEqual(row["commission_amount"], Decimal("280"))
        self.assertEqual(row["payout_amount"], Decimal("1120"))
        retry = await self.respond(result, winner, idempotency_key=f"{winner}-accept-key")
        self.assertEqual(retry, accepted[0])
        self.assertEqual((await self.row("SELECT count(*) AS n FROM dispatch_offers WHERE status='accepted'"))["n"], 1)
        self.assertEqual((await self.row("SELECT count(*) AS n FROM dispatch_events WHERE event_type='accepted'"))["n"], 1)
        with self.assert_http(409):
            await self.respond(result, winner, "decline")

    async def test_same_provider_competing_requests_cannot_overlap(self):
        first = await self.pending("p1")
        second = await self.pending("p2")
        results = []
        for booking in (first, second):
            results.append(await engine.create_dispatch(self.settings, DispatchCreate(booking_id=booking["id"], fanout_count=20, intensity_level=1), {"id": "client"}))
        outcomes = await asyncio.gather(*(self.respond(result, "p3") for result in results), return_exceptions=True)
        self.assertEqual(sum(isinstance(result, dict) for result in outcomes), 1)
        self.assertEqual(sum(isinstance(result, HTTPException) and result.status_code == 409 for result in outcomes), 1)
        self.assertEqual((await self.row("SELECT count(*) AS n FROM bookings WHERE photographer_id='p3' AND status='accepted'"))["n"], 1)

    async def test_declines_and_expired_requests_never_resurrect(self):
        booking, command, result = await self.dispatched()
        for offer in result["offers"]:
            response = await self.respond(result, offer["provider_id"], "decline")
            self.assertEqual(response["status"], "declined")
            self.assertEqual(await self.respond(result, offer["provider_id"], "decline"), response)
        state = await engine.create_dispatch(self.settings, command, {"id": "client"})
        self.assertEqual(state["assignment_state"], "expired")
        self.assertEqual((await self.row("SELECT status FROM bookings WHERE id=$1", booking["id"]))["status"], "cancelled")

    async def test_expired_response_commits_expiry_even_when_returning_409(self):
        booking, command, result = await self.dispatched()
        later = result["dispatch_request"]["expires_at"] + timedelta(seconds=1)
        with patch.object(engine, "utc_now", return_value=later), self.assert_http(409):
            await self.respond(result, "p1")
        row = await self.row("SELECT status FROM dispatch_requests WHERE id=$1", result["dispatch_request"]["id"])
        self.assertEqual(row["status"], "expired")
        self.assertEqual((await self.row("SELECT count(*) AS n FROM dispatch_offers WHERE status='expired'"))["n"], 4)
        retry = await engine.create_dispatch(self.settings, command, {"id": "client"})
        self.assertEqual(retry["assignment_state"], "expired")

    async def test_expiry_is_rechecked_after_provider_lock_wait(self):
        _, _, result = await self.dispatched()
        before = datetime.now(UTC)
        after = result["dispatch_request"]["expires_at"] + timedelta(seconds=1)
        with patch.object(engine, "utc_now", side_effect=[before, after]), self.assert_http(409):
            await self.respond(result, "p1")
        self.assertEqual((await self.row("SELECT status FROM dispatch_requests WHERE id=$1", result["dispatch_request"]["id"]))["status"], "expired")
        self.assertEqual((await self.row("SELECT count(*) AS n FROM dispatch_offers WHERE status='accepted'"))["n"], 0)

    async def test_matching_requires_kyc_online_age_and_open_account(self):
        await self.sql("UPDATE profiles SET kyc_status='pending' WHERE id='p2'")
        await self.sql("UPDATE profiles SET age_verified=false WHERE id='p3'")
        await self.sql("UPDATE api_users SET metadata='{\"deletion_status\":\"pending\"}' WHERE id='p4'")
        _, _, result = await self.dispatched()
        self.assertEqual([offer["provider_id"] for offer in result["offers"]], ["p1"])

    async def test_no_stale_or_fabricated_gps_matching(self):
        await self.sql("UPDATE location_tracks SET created_at=now()-interval '5 minutes'")
        _, _, result = await self.dispatched()
        self.assertEqual(result["offers"], [])
        self.assertEqual(result["assignment_state"], "expired")

    async def test_service_radius_and_published_price_ceiling(self):
        await self.sql("UPDATE photographers SET hourly_rate=2000 WHERE id='p2'")
        await self.sql("UPDATE photographers SET travel_radius=1 WHERE id='p3'")
        await self.sql("UPDATE location_tracks SET latitude=-29.95 WHERE user_id='p3'")
        await self.sql("UPDATE photographers SET is_online=false WHERE id='p4'")
        _, _, result = await self.dispatched()
        self.assertEqual([offer["provider_id"] for offer in result["offers"]], ["p1"])

    async def test_model_service_and_equipment_are_not_client_prices(self):
        await self.sql("UPDATE model_services SET requires_age_verification=true WHERE model_id='m2'")
        _, _, result = await self.dispatched("m1")
        self.assertEqual(result["dispatch_request"]["service_type"], "modeling")
        self.assertEqual([offer["provider_id"] for offer in result["offers"]], ["m1"])
        self.assertEqual(result["offers"][0]["quote"]["pricing_basis"], "session")
        await self.sql("INSERT INTO photographer_equipment (id,photographer_id,tier_id,camera_body) VALUES ('gear','p1','standard','dslr')")
        booking = await self.pending("p1", equipment_selection={"camera": ["dslr"]})
        result = await engine.create_dispatch(self.settings, DispatchCreate(booking_id=booking["id"], fanout_count=20, intensity_level=1), {"id": "client"})
        self.assertEqual([offer["provider_id"] for offer in result["offers"]], ["p1"])
        self.assertEqual(result["offers"][0]["quote"]["equipment_amount"], Decimal("200"))

    async def test_winner_price_can_only_reduce_ceiling_and_offer_snapshot_is_honored(self):
        booking = await self.pending()
        await self.sql("UPDATE photographers SET hourly_rate=1000 WHERE id='p2'")
        result = await engine.create_dispatch(self.settings, DispatchCreate(booking_id=booking["id"], fanout_count=20, intensity_level=5), {"id": "client"})
        await self.sql("UPDATE photographers SET hourly_rate=9000 WHERE id='p2'")
        await self.respond(result, "p2")
        row = await self.row("SELECT quote_amount,commission_amount,payout_amount,pricing_snapshot FROM bookings WHERE id=$1", booking["id"])
        self.assertEqual((row["quote_amount"], row["commission_amount"], row["payout_amount"]), (Decimal("1000"), Decimal("200"), Decimal("800")))
        self.assertEqual(json.loads(row["pricing_snapshot"])["unit_rate"], "1000.00")

    async def test_paid_booking_and_coordinate_or_service_changes_rejected(self):
        booking = await self.pending()
        command = DispatchCreate(booking_id=booking["id"], fanout_count=1, intensity_level=1)
        for changes in ({"requested_lat": -29.9, "requested_lng": 31.03}, {"required_tier": "premium"}, {"service_type": "modeling"}):
            with self.subTest(changes=changes), self.assert_http(409):
                await engine.create_dispatch(self.settings, command.model_copy(update=changes), {"id": "client"})
        await self.sql("UPDATE bookings SET payment_status='paid' WHERE id=$1", booking["id"])
        with self.assert_http(409):
            await engine.create_dispatch(self.settings, command, {"id": "client"})
        self.assertEqual((await self.row("SELECT count(*) AS n FROM dispatch_requests"))["n"], 0)

    async def test_availability_rechecked_and_notification_failure_rolls_back_winner(self):
        booking, _, result = await self.dispatched()
        await self.sql("INSERT INTO blocked_dates (id,user_id,blocked_date) VALUES ('blocked','p2',$1)", self.start.astimezone(ZA_TIME).date().isoformat())
        with self.assert_http(409):
            await self.respond(result, "p2")
        with patch.object(engine, "enqueue", side_effect=RuntimeError("simulated outbox failure")), self.assertRaises(RuntimeError):
            await self.respond(result, "p1")
        self.assertEqual((await self.row("SELECT status FROM bookings WHERE id=$1", booking["id"]))["status"], "pending")
        self.assertEqual((await self.row("SELECT count(*) AS n FROM dispatch_offers WHERE status='accepted'"))["n"], 0)
        await self.respond(result, "p3")

    async def test_closing_requester_and_provider_cannot_commit_assignment(self):
        booking = await self.pending()
        command = DispatchCreate(booking_id=booking["id"], fanout_count=20, intensity_level=1)
        await self.sql("UPDATE api_users SET metadata='{\"deletion_status\":\"pending\"}' WHERE id='client'")
        with self.assert_http(403):
            await engine.create_dispatch(self.settings, command, {"id": "client"})
        await self.sql("UPDATE api_users SET metadata='{}' WHERE id='client'")
        result = await engine.create_dispatch(self.settings, command, {"id": "client"})
        await self.sql("UPDATE api_users SET metadata='{\"deletion_status\":\"processing\"}' WHERE id='p2'")
        with self.assert_http(403):
            await self.respond(result, "p2")
        await self.sql("UPDATE api_users SET metadata='{\"deletion_status\":\"completed\"}' WHERE id='client'")
        with self.assert_http(403):
            await self.respond(result, "p1")
        state = await engine.get_dispatch_state(self.settings, result["dispatch_request"]["id"], {"id": "client"})
        self.assertEqual(state["assignment_state"], "offered")

    async def test_database_rejects_bypass_and_duplicate_winner(self):
        booking, _, result = await self.dispatched()
        with self.assertRaises(asyncpg.CheckViolationError):
            await self.sql("UPDATE bookings SET status='accepted' WHERE id=$1", booking["id"])
        with self.assertRaises(asyncpg.UniqueViolationError):
            await self.sql("UPDATE dispatch_offers SET status='accepted' WHERE dispatch_request_id=$1 AND provider_id IN ('p1','p2')", result["dispatch_request"]["id"])
        await self.respond(result, "p1")
        with self.assertRaises(asyncpg.CheckViolationError):
            await self.sql("UPDATE dispatch_offers SET status='accepted' WHERE dispatch_request_id=$1 AND provider_id='p2'", result["dispatch_request"]["id"])

    async def test_database_quote_and_request_snapshots_are_immutable(self):
        booking, _, result = await self.dispatched()
        for query in ("UPDATE dispatch_requests SET price_base=9999 WHERE id=$1",
                      "UPDATE dispatch_requests SET booking_snapshot='{}'::jsonb WHERE id=$1",
                      "UPDATE dispatch_requests SET expires_at=expires_at+interval '1 hour' WHERE id=$1"):
            with self.subTest(query=query), self.assertRaises(asyncpg.CheckViolationError):
                await self.sql(query, result["dispatch_request"]["id"])
        with self.assertRaises(asyncpg.CheckViolationError):
            await self.sql("UPDATE dispatch_offers SET pricing_snapshot='{}'::jsonb WHERE dispatch_request_id=$1", result["dispatch_request"]["id"])
        await self.respond(result, "p1")
        with self.assertRaises(asyncpg.CheckViolationError):
            await self.sql("UPDATE bookings SET commission_amount=1 WHERE id=$1", booking["id"])

    async def test_cancelled_booking_cancels_offers_and_foreign_response_key_rejected(self):
        booking, _, result = await self.dispatched()
        await self.respond(result, "p3", "decline", idempotency_key="same-response-key")
        await self.sql("UPDATE bookings SET status='cancelled' WHERE id=$1", booking["id"])
        state = await engine.get_dispatch_state(self.settings, result["dispatch_request"]["id"], {"id": "client"})
        self.assertEqual(state["assignment_state"], "cancelled")
        second_booking, _, second = await self.dispatched("p2")
        with self.assert_http(409):
            await self.respond(second, "p3", "decline", idempotency_key="same-response-key")

    async def test_create_notification_failure_is_atomic(self):
        booking = await self.pending()
        with patch.object(engine, "enqueue", side_effect=RuntimeError("simulated outbox failure")), self.assertRaises(RuntimeError):
            await engine.create_dispatch(self.settings, DispatchCreate(booking_id=booking["id"], fanout_count=2, intensity_level=1), {"id": "client"})
        self.assertEqual((await self.row("SELECT count(*) AS n FROM dispatch_requests"))["n"], 0)
        self.assertEqual((await self.row("SELECT count(*) AS n FROM dispatch_offers"))["n"], 0)
        self.assertIsNone((await self.row("SELECT dispatch_request_id FROM bookings WHERE id=$1", booking["id"]))["dispatch_request_id"])

    async def test_real_asgi_payload_and_response_shapes(self):
        booking = await self.pending()
        app = FastAPI()
        app.include_router(engine.router)
        actor = {"id": "client"}
        app.dependency_overrides[get_settings] = lambda: self.settings
        app.dependency_overrides[engine.dispatch_user] = lambda: actor
        with TestClient(app) as client:
            created = client.post("/dispatch/requests", json={"booking_id": booking["id"], "fanout_count": 3, "intensity_level": 1, "base_amount": 1})
            self.assertEqual(created.status_code, 200, created.text)
            body = created.json()
            self.assertIsInstance(body["quote"]["total_amount"], (int, float))
            self.assertIsInstance(body["offers"][0]["quote"]["total_amount"], (int, float))
            actor["id"] = body["offers"][0]["provider_id"]
            response = client.post("/dispatch/respond", json={"dispatch_request_id": body["dispatch_request"]["id"], "offer_id": body["offers"][0]["id"], "response": "accept", "idempotency_key": "asgi-accept-key"})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["status"], "accepted")
            snapshot = client.get(f"/dispatch/requests/{body['dispatch_request']['id']}")
            self.assertEqual(snapshot.status_code, 200)
            self.assertEqual(snapshot.json()["assignment_state"], "accepted")
