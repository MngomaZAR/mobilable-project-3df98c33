import asyncio
import hashlib
import unittest
from datetime import timedelta
from unittest.mock import patch

import asyncpg
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import contracts
from app.config import Settings, get_settings
from app.contracts import ContractCreate, ContractSign

try:
    from .dispatch_protocol import DatabaseCase
except ImportError:
    from dispatch_protocol import DatabaseCase


class ContractValidationTests(unittest.TestCase):
    def test_only_document_content_not_spoofed_parties_or_signatures(self):
        for extra in ({"client_id": "outsider"}, {"creator_signature": "forged"}, {"status": "signed"}, {"content_version": 3}):
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                ContractCreate.model_validate({"contract_type": "shoot_agreement", "content": "Document", **extra})
        for content in ("", " \n ", "hello\x00world"):
            with self.assertRaises(ValidationError):
                ContractCreate(contract_type="model_release", content=content)

    def test_acknowledgement_has_no_client_timestamp_or_actor(self):
        for extra in ({"signer_id": "victim"}, {"signed_at": "2026-01-01"}, {"legal_approved": True}, {"role": "admin"}):
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                ContractSign.model_validate({"signature": "Typed Name", "role": "client", **extra})
        for signature in ("  ", "x", "Name\nVictim", "Name\x00"):
            with self.assertRaises(ValidationError):
                ContractSign(signature=signature, role="client")

    def test_hash_preserves_exact_document_and_unicode(self):
        content = "Acknowledgement: \u00e9\n"
        self.assertEqual(contracts.content_hash(content), hashlib.sha256(content.encode("utf-8")).hexdigest())
        self.assertNotEqual(contracts.content_hash(content), contracts.content_hash(content.rstrip()))

    def test_model_only_has_two_distinct_authenticated_people(self):
        self.assertEqual(contracts.parties({"client_id": "client", "model_id": "model"}), {"client": "client", "creator": "model", "model": "model"})
        self.assertEqual(contracts.parties({"client_id": "client", "photographer_id": "photo", "model_id": "model"}), {"client": "client", "creator": "photo", "model": "model"})

    def test_routes_require_auth_without_main(self):
        app = FastAPI()
        app.include_router(contracts.router)
        app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
        client = TestClient(app)
        self.assertEqual(client.get("/bookings/b/contracts").status_code, 401)
        self.assertEqual(client.post("/bookings/b/contracts", json={"contract_type": "model_release", "content": "Document"}).status_code, 401)
        self.assertEqual(client.post("/contracts/c/sign", json={"role": "client", "signature": "Typed Name"}).status_code, 401)


class ContractDatabaseTests(DatabaseCase):
    async def document(self, provider="p1", actor="client"):
        booking = await self.accepted_booking(provider)
        command = ContractCreate(contract_type="shoot_agreement", content="Participant-provided document. No legal approval is asserted.\n")
        result = await contracts.create_contract(self.settings, booking["id"], command, {"id": actor})
        return booking, command, result

    async def sign(self, document, actor, role, signature="Typed Name", **extra):
        return await contracts.sign_contract(self.settings, document["id"], ContractSign(signature=signature, role=role, **extra), {"id": actor})

    async def test_parties_hash_version_no_fake_photographer_or_legal_approval(self):
        booking, _, doc = await self.document("m1", actor="m1")
        self.assertEqual(doc["model_id"], "m1")
        self.assertEqual(doc["creator_id"], "m1")
        self.assertIsNone(doc["photographer_id"])
        self.assertEqual(doc["created_by"], "m1")
        self.assertEqual(doc["content_hash"], contracts.content_hash(doc["content"]))
        self.assertEqual(doc["content_version"], 1)
        self.assertEqual(doc["legal_approval_status"], "not_reviewed")
        self.assertEqual(doc["signature_method"], "authenticated_typed_acknowledgement")
        self.assertEqual(doc["status"], "draft")

    async def test_create_race_reuses_same_document_and_rejects_changed_content(self):
        booking = await self.accepted_booking()
        command = ContractCreate(contract_type="model_release", content="Exact document")
        rows = await asyncio.gather(*(contracts.create_contract(self.settings, booking["id"], command, {"id": "client"}) for _ in range(4)))
        self.assertEqual(len({row["id"] for row in rows}), 1)
        self.assertEqual((await self.row("SELECT count(*) AS n FROM contracts WHERE content_version IS NOT NULL"))["n"], 1)
        with self.assert_http(409):
            await contracts.create_contract(self.settings, booking["id"], command.model_copy(update={"content": "Changed document"}), {"id": "p1"})

    async def test_outsider_cannot_create_read_or_sign_even_with_admin_metadata(self):
        booking, command, doc = await self.document()
        outsider = {"id": "outsider", "is_admin": True}
        with self.assert_http(403):
            await contracts.create_contract(self.settings, booking["id"], command, outsider)
        with self.assert_http(403):
            await contracts.list_booking_contracts(self.settings, booking["id"], outsider)
        with self.assert_http(403):
            await contracts.sign_contract(self.settings, doc["id"], ContractSign(role="client", signature="Victim Name"), outsider)
        with self.assert_http(403):
            await self.sign(doc, "p1", "client")
        with self.assert_http(403):
            await self.sign(doc, "client", "creator")

    async def test_distinct_participant_sign_race_preserves_both_signatures(self):
        booking, _, doc = await self.document()
        await asyncio.gather(self.sign(doc, "client", "client", "Client Name"), self.sign(doc, "p1", "creator", "Creator Name"))
        row = (await contracts.list_booking_contracts(self.settings, booking["id"], {"id": "client"}))[0]
        self.assertEqual(row["status"], "signed")
        self.assertEqual((row["client_signature"], row["creator_signature"]), ("Client Name", "Creator Name"))
        self.assertTrue(row["signed_by_client"])
        self.assertTrue(row["signed_by_photographer"])
        self.assertFalse(row["signed_by_model"])
        self.assertIsNotNone(row["signed_at"])
        self.assertEqual((await self.row("SELECT count(*) AS n FROM contract_signatures WHERE contract_id=$1", doc["id"]))["n"], 2)

    async def test_model_creator_acknowledgement_maps_both_slots_once(self):
        booking, _, doc = await self.document("m1")
        first = await self.sign(doc, "m1", "model", "Model Name")
        self.assertEqual(first["creator_signature"], "Model Name")
        self.assertEqual(first["model_signature"], "Model Name")
        self.assertEqual(await self.sign(doc, "m1", "creator", "Model Name"), first)
        self.assertEqual(first["status"], "draft")
        signed = await self.sign(doc, "client", "client", "Client Name")
        self.assertEqual(signed["status"], "signed")
        self.assertIsNone(signed["photographer_signed_at"])

    async def test_same_party_race_retry_cannot_overwrite_evidence(self):
        _, _, doc = await self.document()
        rows = await asyncio.gather(*(self.sign(doc, "client", "client", "Client Name") for _ in range(4)))
        self.assertEqual(len({row["client_signed_at"] for row in rows}), 1)
        self.assertEqual((await self.row("SELECT count(*) AS n FROM contract_signatures WHERE contract_id=$1", doc["id"]))["n"], 1)
        with self.assert_http(409):
            await self.sign(doc, "client", "client", "Different Name")

    async def test_stale_hash_or_version_rejected_before_recording(self):
        _, _, doc = await self.document()
        for extra in ({"content_hash": "0" * 64}, {"content_version": 2}):
            with self.subTest(extra=extra), self.assert_http(409):
                await self.sign(doc, "client", "client", **extra)
        self.assertEqual((await self.row("SELECT count(*) AS n FROM contract_signatures"))["n"], 0)
        await self.sign(doc, "client", "client", content_hash=doc["content_hash"], content_version=1)

    async def test_expiry_is_durable_with_409_and_existing_signatures_preserved(self):
        booking, command, doc = await self.document()
        await self.sign(doc, "client", "client")
        with patch.object(contracts, "utc_now", return_value=doc["expires_at"] + timedelta(seconds=1)), self.assert_http(409):
            await self.sign(doc, "p1", "creator")
        row = await self.row("SELECT status,client_signature FROM contracts WHERE id=$1", doc["id"])
        self.assertEqual(row["status"], "expired")
        self.assertEqual(row["client_signature"], "Typed Name")
        self.assertEqual((await contracts.create_contract(self.settings, booking["id"], command, {"id": "client"}))["status"], "expired")

    async def test_pending_cancelled_and_completed_lifecycle(self):
        pending = await self.pending()
        command = ContractCreate(contract_type="shoot_agreement", content="Document")
        with self.assert_http(409):
            await contracts.create_contract(self.settings, pending["id"], command, {"id": "client"})
        await self.sql("UPDATE bookings SET status='accepted' WHERE id=$1", pending["id"])
        doc = await contracts.create_contract(self.settings, pending["id"], command, {"id": "client"})
        await self.sql("UPDATE bookings SET status='cancelled' WHERE id=$1", pending["id"])
        with self.assert_http(409):
            await self.sign(doc, "client", "client")
        self.assertEqual((await contracts.list_booking_contracts(self.settings, pending["id"], {"id": "p1"}))[0]["status"], "expired")
        second, _, signed = await self.document("p2")
        await self.sign(signed, "client", "client")
        await self.sign(signed, "p2", "creator")
        await self.sql("UPDATE bookings SET status='completed',payment_status='paid' WHERE id=$1", second["id"])
        self.assertEqual((await contracts.list_booking_contracts(self.settings, second["id"], {"id": "client"}))[0]["status"], "signed")
        with self.assert_http(409):
            await contracts.create_contract(self.settings, second["id"], ContractCreate(contract_type="model_release", content="New document"), {"id": "client"})

    async def test_closing_any_party_blocks_new_document_and_acknowledgement(self):
        booking, _, doc = await self.document()
        for actor in ("p1", "client"):
            await self.sql("UPDATE api_users SET metadata='{\"deletion_status\":\"processing\"}' WHERE id=$1", actor)
            with self.assert_http(403):
                await self.sign(doc, "client", "client")
            with self.assert_http(403):
                await contracts.create_contract(self.settings, booking["id"], ContractCreate(contract_type="model_release", content="Other document"), {"id": "client"})
            self.assertEqual(len(await contracts.list_booking_contracts(self.settings, booking["id"], {"id": "client"})), 1)
            await self.sql("UPDATE api_users SET metadata='{}' WHERE id=$1", actor)

    async def test_notification_failure_rolls_back_creation_and_signature(self):
        booking = await self.accepted_booking()
        command = ContractCreate(contract_type="shoot_agreement", content="Document")
        with patch.object(contracts, "enqueue", side_effect=RuntimeError("simulated outbox failure")), self.assertRaises(RuntimeError):
            await contracts.create_contract(self.settings, booking["id"], command, {"id": "client"})
        self.assertEqual((await self.row("SELECT count(*) AS n FROM contracts"))["n"], 0)
        doc = await contracts.create_contract(self.settings, booking["id"], command, {"id": "client"})
        with patch.object(contracts, "enqueue", side_effect=RuntimeError("simulated outbox failure")), self.assertRaises(RuntimeError):
            await self.sign(doc, "client", "client")
        self.assertEqual((await self.row("SELECT count(*) AS n FROM contract_signatures"))["n"], 0)
        self.assertIsNone((await self.row("SELECT client_signature FROM contracts WHERE id=$1", doc["id"]))["client_signature"])

    async def test_database_rejects_content_party_signature_and_evidence_overwrites(self):
        _, _, doc = await self.document()
        with self.assertRaises(asyncpg.CheckViolationError):
            await self.sql("INSERT INTO contracts SELECT * FROM jsonb_populate_record(NULL::contracts,(SELECT to_jsonb(c)||jsonb_build_object('id','forged','status','signed','client_signature','Forged') FROM contracts c WHERE id=$1))", doc["id"])
        with self.assertRaises(asyncpg.CheckViolationError):
            await self.sql("INSERT INTO contract_signatures (contract_id,signer_id,signature,content_hash,content_version,method,signed_at) VALUES ($1,'outsider','Forged',$2,1,'authenticated_typed_acknowledgement',now())", doc["id"], doc["content_hash"])
        for query in ("UPDATE contracts SET content='Changed',body='Changed' WHERE id=$1",
                      "UPDATE contracts SET client_id='outsider' WHERE id=$1",
                      "UPDATE contracts SET client_signature='Forged' WHERE id=$1",
                      "DELETE FROM contracts WHERE id=$1"):
            with self.subTest(query=query), self.assertRaises(asyncpg.CheckViolationError):
                await self.sql(query, doc["id"])
        await self.sign(doc, "client", "client")
        for query in ("UPDATE contract_signatures SET signature='Changed' WHERE contract_id=$1",
                      "DELETE FROM contract_signatures WHERE contract_id=$1",
                      "UPDATE contracts SET client_signature='Changed' WHERE id=$1"):
            with self.subTest(query=query), self.assertRaises(asyncpg.CheckViolationError):
                await self.sql(query, doc["id"])

    async def test_legacy_signature_flags_are_never_promoted_to_evidence(self):
        booking = await self.accepted_booking()
        await self.sql("INSERT INTO contracts (id,booking_id,client_id,creator_id,status,client_signature,creator_signature) VALUES ('legacy',$1,'client','p1','signed','Untrusted','Untrusted')", booking["id"])
        self.assertEqual(await contracts.list_booking_contracts(self.settings, booking["id"], {"id": "client"}), [])
        with self.assert_http(404):
            await contracts.sign_contract(self.settings, "legacy", ContractSign(role="client", signature="Typed Name"), {"id": "client"})
        with self.assertRaises(asyncpg.CheckViolationError):
            await self.sql("UPDATE contracts SET content_version=1 WHERE id='legacy'")

    async def test_real_asgi_contract_service_shape(self):
        booking = await self.accepted_booking("m1")
        app = FastAPI()
        app.include_router(contracts.router)
        actor = {"id": "client"}
        app.dependency_overrides[get_settings] = lambda: self.settings
        app.dependency_overrides[contracts.contract_user] = lambda: actor
        with TestClient(app) as client:
            created = client.post(f"/bookings/{booking['id']}/contracts", json={"contract_type": "model_release", "content": "Participant document"})
            self.assertEqual(created.status_code, 200, created.text)
            doc = created.json()
            signed = client.post(f"/contracts/{doc['id']}/sign", json={"role": "client", "signature": "Client Name", "content_hash": doc["content_hash"], "content_version": doc["content_version"]})
            self.assertEqual(signed.status_code, 200, signed.text)
            actor["id"] = "m1"
            signed = client.post(f"/contracts/{doc['id']}/sign", json={"role": "model", "signature": "Model Name"})
            self.assertEqual(signed.status_code, 200, signed.text)
            self.assertEqual(signed.json()["status"], "signed")
            listed = client.get(f"/bookings/{booking['id']}/contracts")
            self.assertEqual(listed.status_code, 200)
            self.assertEqual(len(listed.json()), 1)
