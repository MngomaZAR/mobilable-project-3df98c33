"""Destructive QA fixtures: refuse any database that is not explicitly named *_qa_*.

Exercises real HTTP and PostgreSQL on Oracle. Gateway validation is not mocked here:
unconfigured payments/video are reported as blockers, never as successful transactions.
"""
import asyncio
import base64
import json
import os
import secrets
import statistics
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import asyncpg
import httpx

from app.local_auth import hash_password, token_digest


ADMIN = "qa-admin-20261003"
PASSWORD = "QA-only-not-a-real-user-2026!"
TEST_IMAGE = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCfsAAAAASUVORK5CYII=")
START = (datetime.now(UTC) + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
BASE_URL = os.getenv("QA_API_URL", "http://papzii-api-qa:8000")
report = {"environment": "isolated Oracle QA", "started_at": datetime.now(UTC).isoformat(), "checks": [], "blockers": [], "load": {}}


async def seed():
    url = os.environ["DATABASE_URL"]
    if "_qa_" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("REFUSING test fixtures outside an explicitly named QA database")
    conn = await asyncpg.connect(url)
    actors = {}
    password_hash = hash_password(PASSWORD)
    try:
        await conn.execute('DELETE FROM auth_rate_limits')
        # Release only unpaid synthetic protocol holds left by an interrupted QA run.
        await conn.execute("UPDATE bookings SET status='cancelled',updated_at=now() WHERE client_id='qa-client-0' AND idempotency_key LIKE 'protocol-%' AND status IN ('pending','accepted') AND coalesce(payment_status,'unpaid')<>'paid'")
        for role, count in [("client", 100), ("photographer", 100), ("model", 100), ("admin", 1)]:
            actors[role] = []
            for index in range(count):
                user_id = ADMIN if role == "admin" else f"qa-{role}-{index}"
                token = secrets.token_urlsafe(48)
                metadata = json.dumps({"role": "client" if role == "admin" else role, "full_name": f"QA {role} {index}"})
                await conn.execute("INSERT INTO api_users (id,email,password_hash,metadata) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING", user_id, f"{user_id}@example.invalid", password_hash, metadata)
                await conn.execute("INSERT INTO profiles (id,email,full_name,role,verified,age_verified,kyc_status,city) VALUES ($1,$2,$3,$4,true,true,'approved','Durban') ON CONFLICT(id) DO NOTHING", user_id, f"{user_id}@example.invalid", f"QA {role} {index}", role)
                await conn.execute("INSERT INTO api_sessions (access_token,refresh_token,user_id,expires_at,refresh_expires_at) VALUES ($1,$2,$3,now()+interval '1 day',now()+interval '2 days')", token_digest(token), token_digest(secrets.token_urlsafe(48)), user_id)
                if role in {"photographer", "model"}:
                    table = "photographers" if role == "photographer" else "models"
                    await conn.execute(f"INSERT INTO {table} (id,name,latitude,longitude,hourly_rate,travel_radius) VALUES ($1,$2,-29.85,31.03,1400,50) ON CONFLICT(id) DO NOTHING", user_id, f"QA {role} {index}")
                    for day in range(7):
                        await conn.execute("INSERT INTO availability (user_id,day_of_week,start_time,end_time,is_available) VALUES ($1,$2,'08:00','21:00',true) ON CONFLICT(user_id,day_of_week) DO UPDATE SET is_available=true", user_id, day)
                    if role == 'model':
                        await conn.execute("INSERT INTO model_services (id,model_id,service_type,rate_zar,is_active,requires_age_verification) VALUES ($1,$2,'fashion_shoot',2200,true,false) ON CONFLICT(model_id,service_type) DO UPDATE SET is_active=true,rate_zar=2200,requires_age_verification=false", secrets.token_hex(16), user_id)
                actors[role].append({"id": user_id, "token": token})
    finally:
        await conn.close()
    return actors


def headers(actor):
    return {"Authorization": f"Bearer {actor['token']}"}


def booking(actor, provider, key):
    return {"photographer_id": provider["id"] if "photographer" in provider["id"] else None,
            "model_id": provider["id"] if "model" in provider["id"] else None,
            "package_id": "standard" if 'photographer' in provider['id'] else None,
            "model_service_type": 'fashion_shoot' if 'model' in provider['id'] else None,
            "start_datetime": START.isoformat(), "end_datetime": (START + timedelta(hours=1)).isoformat(),
            "user_latitude": -29.85, "user_longitude": 31.03, "idempotency_key": key}


async def check(client, name, method, path, expected, actor=None, body=None):
    response = await client.request(method, path, json=body, headers=headers(actor) if actor else {})
    passed = response.status_code in (expected if isinstance(expected, list) else [expected])
    report["checks"].append({"name": name, "passed": passed, "status": response.status_code})
    if not passed:
        raise AssertionError(f"{name}: HTTP {response.status_code}: {response.text[:250]}")
    return response


async def write_load(client, actors):
    errors, timings, completed = [], [], []

    async def booking_journey(role, index):
        requester, creator = actors["client"][index], actors[role][index]
        command = booking(requester, creator, f"load-{secrets.token_hex(12)}")
        booking_id = None

        async def request(method, path, actor, body):
            began = time.perf_counter()
            try:
                response = await client.request(method, path, headers=headers(actor), json=body)
            except httpx.HTTPError as error:
                raise RuntimeError(f"{type(error).__name__} at {method} {path}") from error
            timings.append((time.perf_counter() - began) * 1000)
            if response.status_code != 200:
                raise RuntimeError(f"{method} {path}: {response.status_code} {response.text[:180]}")
            return response.json()

        try:
            booking_id = (await request("POST", "/bookings", requester, command))["id"]
            retried = await request("POST", "/bookings", requester, command)
            assert retried["id"] == booking_id, f"Booking retry changed ID: {booking_id} -> {retried.get('id')}"
            await request("PATCH", f"/bookings/{booking_id}", creator, {"status": "accepted"})
            chat = await request("POST", "/functions/conversation-start", requester, {"participant_id": creator["id"]})
            sent = await request("POST", "/functions/chat-messages", requester, {"conversation_id": chat["id"], "action": "send", "text": f"Load shoot {booking_id}", 'client_message_id': f'load-{booking_id}'})
            received = await request("POST", "/functions/chat-messages", creator, {"conversation_id": chat["id"], "action": "list"})
            assert any(row["id"] == sent["message"]["id"] for row in received["messages"]), f"Read-after-send lost message {sent['message']['id']} in conversation {chat['id']}; received IDs: {[row['id'] for row in received['messages']]}"
            await request("PATCH", f"/bookings/{booking_id}", requester, {"status": "cancelled"})
            completed.append(booking_id)
        except Exception as error:
            errors.append({"role": role, "index": index, "error_type": type(error).__name__, "error": str(error)})
            if booking_id:
                await client.patch(f"/bookings/{booking_id}", headers=headers(requester), json={"status": "cancelled"})

    began = time.perf_counter()
    await asyncio.gather(*(booking_journey(role, index) for role in ["photographer", "model"] for index in range(100)))
    timings.sort()
    report["write_load"] = {"simultaneous_booking_journeys": 200, "completed_journeys": len(completed), "requests": len(timings), "errors": len(errors), "error_examples": errors[:10], "elapsed_seconds": round(time.perf_counter() - began, 2), "p95_ms": round(timings[int(len(timings) * .95) - 1], 2), "scope": "100 photographer and 100 model bookings: request, retry, accept, chat, send, receive, cancel; no real-money transactions"}
    contenders, provider = [actors["client"][5], actors["client"][6]], actors["photographer"][0]
    race = await asyncio.gather(*(client.post("/bookings", headers=headers(actor), json=booking(actor, provider, f"race-{secrets.token_hex(12)}")) for actor in contenders))
    assert sorted(row.status_code for row in race) == [200, 409]
    for actor, response in zip(contenders, race):
        if response.status_code == 200:
            await check(client, "Concurrent slot winner can cancel", "PATCH", f"/bookings/{response.json()['id']}", 200, actor, {"status": "cancelled"})
    report["checks"].append({"name": "Concurrent slot protection", "passed": True})
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        for _ in range(30):
            pending = await conn.fetchval("SELECT count(*) FROM job_outbox WHERE status<>'done'")
            if not pending:
                break
            await asyncio.sleep(2)
        counts = {row["status"]: row["count"] for row in await conn.fetch("SELECT status,count(*) AS count FROM job_outbox GROUP BY status")}
        notifications = await conn.fetchval("SELECT count(*) FROM notification_events")
        report["async_worker"] = {"outbox": counts, "persisted_notifications": notifications, "passed": not pending and notifications >= 600, "scope": "Durable in-app delivery, not device push delivery"}
        if pending:
            report["blockers"].append({"feature": "Durable background notifications", "reason": f"{pending} jobs did not finish"})
    finally:
        await conn.close()


async def main():
    actors = await seed()
    client_actor, provider, model, admin = [actors[role][0] for role in ["client", "photographer", "model", "admin"]]
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30, limits=httpx.Limits(max_connections=400, max_keepalive_connections=100)) as client:
        await check(client, "Database schema contract", "GET", "/health/contract", 200)
        readiness = (await check(client, "Release gate reports unavailable capabilities", "GET", "/health/readiness", 200)).json()
        assert readiness["required_capabilities_available"] is False
        report["release_capabilities"] = readiness
        await check(client, "Anonymous bookings denied", "POST", "/data/bookings", 401, body={"action": "select"})
        await check(client, "Auth tables denied", "POST", "/data/api_users", 403, client_actor, {"action": "select"})
        await check(client, "Client cannot approve KYC", "POST", "/functions/admin-review", 403, client_actor, {"action": "list_pending"})
        await check(client, "Admin can review queue", "POST", "/functions/admin-review", 200, admin, {"action": "list_pending"})
        gear = {"action": "upsert", "onConflict": "photographer_id", "payload": {"photographer_id": provider["id"], "tier_id": "standard", "camera_body": "Synthetic QA Camera", "lenses": ["prime", "QA Custom Lens"], "extras": ["audio"]}}
        await check(client, "Photographer equipment save", "POST", "/data/photographer_equipment", 200, provider, gear)
        await check(client, "Photographer equipment retry", "POST", "/data/photographer_equipment", 200, provider, gear)
        gear_rows = (await check(client, "Equipment arrays round-trip", "POST", "/data/photographer_equipment", 200, provider, {"action": "select", "filters": [{"op": "eq", "column": "photographer_id", "value": provider["id"]}]})).json()["data"]
        assert len(gear_rows) == 1 and gear_rows[0]["lenses"] == ["prime", "QA Custom Lens"] and gear_rows[0]["extras"] == ["audio"]
        provider_row = (await check(client, "Equipment tier updates provider atomically", "POST", "/data/photographers", 200, provider, {"action": "select", "filters": [{"op": "eq", "column": "id", "value": provider["id"]}], "single": True})).json()["data"]
        assert provider_row["tier_id"] == "standard"
        await check(client, "Equipment owner spoof denied", "POST", "/data/photographer_equipment", 403, client_actor, gear)
        service = {'services': [{'service_type': 'fashion_shoot', 'rate_zar': 2200}]}
        await check(client, "Model service typed save", "POST", "/providers/me/model-services", 200, model, service)
        await check(client, "Model service retry", "POST", "/providers/me/model-services", 200, model, service)
        saved = (await check(client, "Model service round-trip", "POST", "/data/model_services", 200, model, {"action": "select", "filters": [{"op": "eq", "column": "model_id", "value": model["id"]}]})).json()["data"]
        assert any(row["service_type"] == "fashion_shoot" and row["is_active"] and float(row["rate_zar"]) == 2200 for row in saved)
        await check(client, "Explicit service rejected by API", "POST", "/providers/me/model-services", 422, model, {'services': [{'service_type': 'adult_content', 'rate_zar': 2200}]})
        await check(client, 'Generic model service writes cannot bypass atomic command', 'POST', '/data/model_services', 403, model, {'action': 'update', 'payload': {'is_active': False}})
        registration = await check(client, "Registration creates profile atomically", "POST", "/auth/sign-up", 200, body={"email": f"qa-registration-{secrets.token_hex(4)}@example.invalid", "password": PASSWORD, "options": {"metadata": {"role": "client", "age_verified": True, "verified": True}}})
        registered = registration.json()
        registered_actor = {"id": registered["user"]["id"], "token": registered["session"]["access_token"]}
        profile = await check(client, "Registered profile is not self-verified", "POST", "/data/profiles", 200, registered_actor, {"action": "select", "filters": [{"op": "eq", "column": "id", "value": registered_actor["id"]}], "single": True})
        assert profile.json()["data"]["age_verified"] is False and profile.json()["data"]["verified"] is False
        for role in ["client", "photographer", "model", "admin"]:
            actor = actors[role][0]
            await check(client, f"{role} email sign-in", "POST", "/auth/sign-in", 200, body={"email": f"{actor['id']}@example.invalid", "password": PASSWORD})
            await check(client, f"{role} authenticated identity", "GET", "/auth/me", 200, actor)
        for role, table in [("photographer", "photographers"), ("model", "models")]:
            registered = (await check(client, f"{role} registration", "POST", "/auth/sign-up", 200, body={"email": f"qa-{role}-signup-{secrets.token_hex(4)}@example.invalid", "password": PASSWORD, "options": {"metadata": {"role": role, "full_name": "New creator"}}})).json()
            actor = {"id": registered["user"]["id"], "token": registered["session"]["access_token"]}
            row = (await check(client, f"{role} provider row exists", "POST", f"/data/{table}", 200, actor, {"action": "select", "filters": [{"op": "eq", "column": "id", "value": actor["id"]}], "single": True})).json()["data"]
            assert float(row["rating"]) == 0 and row["review_count"] == 0
            await check(client, f"{role} underage declaration denied", "POST", "/auth/age-confirm", 400, actor, {"date_of_birth": "2020-01-01", "accepted_terms": True})
            await check(client, f"{role} missing terms denied", "POST", "/auth/age-confirm", 422, actor, {"date_of_birth": "1995-01-01"})
            age_profile = (await check(client, f"{role} adult declaration persisted", "POST", "/auth/age-confirm", 200, actor, {"date_of_birth": "1995-01-01", "accepted_terms": True})).json()["profile"]
            assert age_profile["age_verified"] is True and age_profile["verified"] is False
            await check(client, f"{role} missing identity documents denied", "POST", "/kyc/submit", 409, actor, {})
            await check(client, f"{role} cannot bypass document review", "POST", "/functions/admin-review", 409, admin, {"action": "decide_verification", "user_id": actor["id"], "decision": "approved"})
            documents = []
            for doc_type in ["passport", "selfie"]:
                uploaded = (await check(client, f"{role} private {doc_type} upload", "POST", "/storage/upload", 200, actor, {"bucket": "kyc-documents", "contentType": "image/png", "base64": base64.b64encode(TEST_IMAGE).decode()})).json()
                document = (await check(client, f"{role} records {doc_type}", "POST", "/kyc/documents", 200, actor, {"doc_type": doc_type, "storage_path": uploaded["storageRef"]})).json()["document"]
                documents.append(document)
                await check(client, f"Outsider denied {role} {doc_type}", "POST", "/storage/signed-url", 403, client_actor, {"bucket": uploaded["bucket"], "path": uploaded["path"]})
            await check(client, f"{role} submits identity review", "POST", "/kyc/submit", 200, actor, {})
            await check(client, f"{role} cannot approve own document", "POST", "/functions/admin-review", 403, actor, {"action": "decide_kyc_document", "document_id": documents[0]["id"], "decision": "approved"})
            for document in documents:
                await check(client, f"Admin reviews {role} {document['doc_type']}", "POST", "/functions/admin-review", 200, admin, {"action": "decide_kyc_document", "document_id": document["id"], "decision": "approved"})
            verified = (await check(client, f"Admin approves {role} identity", "POST", "/functions/admin-review", 200, admin, {"action": "decide_verification", "user_id": actor["id"], "decision": "approved"})).json()["profile"]
            assert verified["verified"] is True
            await check(client, f"Admin rejects revised {role} document", "POST", "/functions/admin-review", 200, admin, {"action": "decide_kyc_document", "document_id": documents[0]["id"], "decision": "rejected"})
            revoked = (await check(client, f"{role} verification revoked on rejection", "POST", "/data/profiles", 200, actor, {"action": "select", "filters": [{"op": "eq", "column": "id", "value": actor["id"]}], "single": True})).json()["data"]
            assert revoked["verified"] is False and revoked["kyc_status"] == "rejected"
            token = registered["session"]["refresh_token"]
            rotated = (await check(client, f"{role} session refresh", "POST", "/auth/refresh", 200, body={"refresh_token": token})).json()
            await check(client, f"{role} stale refresh rejected", "POST", "/auth/refresh", 401, body={"refresh_token": token})
            await check(client, f"{role} old access rejected", "GET", "/auth/me", 401, actor)
            await check(client, f"{role} rotated access works", "GET", "/auth/me", 200, {"token": rotated["session"]["access_token"]})
        command = booking(client_actor, provider, f"role-booking-{secrets.token_hex(8)}")
        created = (await check(client, "Client requests photographer", "POST", "/bookings", 200, client_actor, command)).json()
        retried = (await check(client, "Booking retry is idempotent", "POST", "/bookings", 200, client_actor, command)).json()
        assert created["id"] == retried["id"] and float(created["total_amount"]) == 1400
        await check(client, "Client cannot accept own request", "PATCH", f"/bookings/{created['id']}", 403, client_actor, {"status": "accepted"})
        await check(client, "Creator accepts booking", "PATCH", f"/bookings/{created['id']}", 200, provider, {"status": "accepted"})
        location_payload = {'latitude': -29.85, 'longitude': 31.03, 'accuracy_m': 12.0}
        await check(client, 'Unpaid booking cannot start location sharing', 'POST', f"/bookings/{created['id']}/location", 409, provider, location_payload)
        await check(client, 'Outsider cannot share booking location', 'POST', f"/bookings/{created['id']}/location", 403, model, location_payload)
        await check(client, 'Generic location trail writes denied', 'POST', '/data/location_tracks', 403, provider, {'action': 'insert', 'payload': {**location_payload, 'booking_id': created['id']}})
        await check(client, "Unpaid booking cannot complete", "PATCH", f"/bookings/{created['id']}", 409, provider, {"status": "completed"})
        await check(client, "Client cannot write payment status", "POST", "/data/payments", 403, client_actor, {"action": "update", "payload": {"status": "completed"}})
        await check(client, "Outsider cannot read booking", "POST", "/data/bookings", 200, model, {"action": "select", "filters": [{"op": "eq", "column": "id", "value": created["id"]}]})
        outsider = await client.post("/data/bookings", headers=headers(model), json={"action": "select", "filters": [{"op": "eq", "column": "id", "value": created["id"]}]})
        assert outsider.json()["data"] == []
        await check(client, "Decline photographer fixture releases slot", "PATCH", f"/bookings/{created['id']}", 200, client_actor, {"status": "cancelled"})
        model_booking = (await check(client, "Client requests model", "POST", "/bookings", 200, client_actor, booking(client_actor, model, f"model-booking-{secrets.token_hex(8)}"))).json()
        await check(client, "Model accepts booking", "PATCH", f"/bookings/{model_booking['id']}", 200, model, {"status": "accepted"})
        await check(client, "Cancel model fixture", "PATCH", f"/bookings/{model_booking['id']}", 200, client_actor, {"status": "cancelled"})
        conversation = (await check(client, "Create client creator chat", "POST", "/functions/conversation-start", 200, client_actor, {"participant_id": provider["id"]})).json()
        again = (await check(client, "Chat creation is idempotent", "POST", "/functions/conversation-start", 200, client_actor, {"participant_id": provider["id"]})).json()
        assert conversation["id"] == again["id"]
        message_payload = {"conversation_id": conversation["id"], "action": "send", "text": "QA booking details", 'client_message_id': f'qa-{secrets.token_hex(12)}'}
        original = (await check(client, "Send persistent message", "POST", "/functions/chat-messages", 200, client_actor, message_payload)).json()
        replayed = (await check(client, 'Message retry returns same row', 'POST', '/functions/chat-messages', 200, client_actor, message_payload)).json()
        assert original['message']['id'] == replayed['message']['id']
        await check(client, 'Changed message with same key rejected', 'POST', '/functions/chat-messages', 409, client_actor, {**message_payload, 'text': 'Different body'})
        await check(client, "Creator receives conversation", "POST", "/functions/chat-messages", 200, provider, {"conversation_id": conversation["id"], "action": "list"})
        await check(client, 'Creator marks incoming messages read', 'POST', '/functions/chat-messages', 200, provider, {'conversation_id': conversation['id'], 'action': 'read'})
        reaction = {'conversation_id': conversation['id'], 'action': 'react', 'message_id': original['message']['id'], 'emoji': '\u2764\ufe0f', 'operation': 'add'}
        await check(client, 'Creator can react to received message', 'POST', '/functions/chat-messages', 200, provider, reaction)
        await check(client, 'Reaction retry is idempotent', 'POST', '/functions/chat-messages', 200, provider, reaction)
        reactions = (await check(client, 'Sender can read participant reactions', 'POST', '/data/message_reactions', 200, client_actor, {'action': 'select', 'filters': [{'op': 'eq', 'column': 'message_id', 'value': original['message']['id']}]})).json()['data']
        assert len(reactions) == 1 and reactions[0]['user_id'] == provider['id']
        await check(client, 'Only sender can delete message', 'POST', '/functions/chat-messages', 403, provider, {'conversation_id': conversation['id'], 'action': 'delete', 'message_id': original['message']['id']})
        await check(client, 'Sender deletes message', 'POST', '/functions/chat-messages', 200, client_actor, {'conversation_id': conversation['id'], 'action': 'delete', 'message_id': original['message']['id']})
        after_delete = (await check(client, 'Deleted message absent for recipient', 'POST', '/functions/chat-messages', 200, provider, {'conversation_id': conversation['id'], 'action': 'list'})).json()['messages']
        assert original['message']['id'] not in {message['id'] for message in after_delete}
        await check(client, "Outsider cannot enter chat", "POST", "/functions/chat-messages", 403, model, {"conversation_id": conversation["id"], "action": "list"})
        await check(client, "Fabricated message unlock denied", "POST", "/functions/chat-messages", 409, client_actor, {"conversation_id": conversation["id"], "action": "unlock"})
        await check(client, "Incomplete booking review denied", "POST", "/reviews", 409, client_actor, {"booking_id": created["id"], "rating": 5})
        await check(client, "Boolean availability filter", "POST", "/data/availability", 200, provider, {"action": "select", "filters": [{"op": "is", "column": "is_available", "value": True}]})
        await check(client, 'Client cannot publish creator availability', 'POST', '/providers/me/availability', 403, client_actor, {'is_online': True})
        for creator in [provider, model]:
            saved_presence = (await check(client, 'Creator availability saved atomically', 'POST', '/providers/me/availability', 200, creator, {'is_online': True, 'user_id': 'victim'})).json()
            assert saved_presence['is_online'] is True
            read_presence = (await check(client, 'Creator availability round trip', 'GET', '/providers/me/availability', 200, creator)).json()
            assert read_presence['is_online'] is True
            await check(client, 'Creator can go offline', 'POST', '/providers/me/availability', 200, creator, {'is_online': False})
        await check(client, 'Generic presence bypass denied', 'POST', '/data/profiles', 403, provider, {'action': 'update', 'payload': {'availability_status': 'online'}})
        image = TEST_IMAGE
        uploaded = (await check(client, "Private attachment upload to MinIO", "POST", "/storage/upload", 200, client_actor, {"bucket": "chat-media", "contentType": "image/png", "base64": base64.b64encode(image).decode()})).json()
        await check(client, "Attach private media to chat", "POST", "/functions/chat-messages", 200, client_actor, {"conversation_id": conversation["id"], "action": "send", 'message_type': 'media', "media_url": uploaded["storageRef"], 'client_message_id': f'qa-{secrets.token_hex(12)}'})
        signed = (await check(client, "Recipient can resolve chat attachment", "POST", "/storage/signed-url", 200, provider, {"bucket": uploaded["bucket"], "path": uploaded["path"]})).json()
        media_url = urlsplit(signed["url"])
        media = await check(client, "Signed media returns original bytes", "GET", media_url.path + "?" + media_url.query, 200)
        assert media.content == image
        await check(client, "Outsider cannot resolve private media", "POST", "/storage/signed-url", 403, model, {"bucket": uploaded["bucket"], "path": uploaded["path"]})
        post = (await check(client, "Creator publishes into moderation", "POST", "/data/posts", 200, provider, {"action": "insert", "payload": {"caption": "QA portfolio post", "is_locked": False}, "single": True})).json()["data"]
        assert post["moderation_status"] == "pending" and post["author_id"] == provider["id"]
        pending = (await check(client, "Pending feed content hidden from clients", "POST", "/data/posts", 200, client_actor, {"action": "select", "filters": [{"op": "eq", "column": "id", "value": post["id"]}]})).json()["data"]
        assert pending == []
        ranked = (await check(client, "Ranking excludes unapproved posts", "POST", "/functions/for-you-ranking", 200, client_actor, {"limit": 100})).json()["ranked_posts"]
        assert post["id"] not in {row["post_id"] for row in ranked}
        await check(client, "Unapproved post cannot be liked by client", "POST", "/rpc/toggle_post_like", 404, client_actor, {"p_post_id": post["id"], "p_user_id": client_actor["id"]})
        await check(client, "Admin approves feed content", "POST", "/data/posts", 200, admin, {"action": "update", "payload": {"moderation_status": "approved"}, "filters": [{"op": "eq", "column": "id", "value": post["id"]}]})
        visible = (await check(client, "Approved feed content is discoverable", "POST", "/data/posts", 200, client_actor, {"action": "select", "filters": [{"op": "eq", "column": "id", "value": post["id"]}]})).json()["data"]
        assert len(visible) == 1
        report_payload = {'target_type': 'post', 'target_id': post['id'], 'reason': 'QA spam report', 'details': 'Synthetic moderation fixture'}
        reported = (await check(client, 'Report creates an admin case atomically', 'POST', '/moderation/reports', 200, client_actor, report_payload)).json()
        queued_case = (await check(client, 'Admin receives the reported case', 'POST', '/data/moderation_cases', 200, admin, {'action': 'select', 'filters': [{'op': 'eq', 'column': 'id', 'value': reported['case_id']}]})).json()['data']
        assert len(queued_case) == 1 and queued_case[0]['reporter_id'] == client_actor['id']
        await check(client, 'Outsider cannot report private booking', 'POST', '/moderation/reports', 404, model, {'target_type': 'booking', 'target_id': created['id'], 'reason': 'QA invisible fixture'})
        comment_payload = {'post_id': post['id'], 'text': 'Synthetic QA comment', 'idempotency_key': f'comment-{secrets.token_hex(12)}'}
        commented = (await check(client, 'Comment enters moderation atomically', 'POST', '/social/comments', 200, client_actor, comment_payload)).json()['comment']
        replayed_comment = (await check(client, 'Comment retry is idempotent', 'POST', '/social/comments', 200, client_actor, comment_payload)).json()['comment']
        assert commented['id'] == replayed_comment['id'] and commented['moderation_status'] == 'pending'
        private_comment = (await check(client, 'Pending comments hidden from other users', 'POST', '/data/post_comments', 200, model, {'action': 'select', 'filters': [{'op': 'eq', 'column': 'id', 'value': commented['id']}]})).json()['data']
        assert private_comment == []
        await check(client, 'Client cannot moderate comments', 'POST', '/moderation/review', 403, client_actor, {'table': 'post_comments', 'id': commented['id'], 'decision': 'approved'})
        await check(client, 'Admin approves comment', 'POST', '/moderation/review', 200, admin, {'table': 'post_comments', 'id': commented['id'], 'decision': 'approved'})
        shared_comment = (await check(client, 'Approved comment is visible', 'POST', '/data/post_comments', 200, model, {'action': 'select', 'filters': [{'op': 'eq', 'column': 'id', 'value': commented['id']}]})).json()['data']
        assert len(shared_comment) == 1
        await check(client, "Approved post can be liked", "POST", "/rpc/toggle_post_like", 200, client_actor, {"p_post_id": post["id"], "p_user_id": client_actor["id"]})
        await check(client, "Direct engagement counter bypass denied", "POST", "/data/post_likes", 403, client_actor, {"action": "insert", "payload": {"post_id": post["id"]}})
        await check(client, "Financial post entitlement write denied", "POST", "/data/post_unlocks", 403, client_actor, {"action": "insert", "payload": {"post_id": post["id"], "amount_paid": 1}})
        for name, path, body in [("Video calls", "/functions/livekit-token", {"creator_id": provider["id"]}), ("Instant dispatch", "/functions/dispatch-create", {"booking_id": created["id"]}), ("Payment checkout", "/payments/checkout", {"booking_id": created["id"]}), ("Road routing", "/routing/route?start_lat=-29.85&start_lng=31.03&end_lat=-29.87&end_lng=31.04", None)]:
            response = await client.request("GET" if body is None else "POST", path, headers=headers(client_actor), json=body)
            if response.status_code != 200:
                report["blockers"].append({"feature": name, "status": response.status_code, "reason": response.json().get("detail")})
            elif name == "Road routing":
                route = response.json()
                assert len(route["coordinates"]) > 2 and route["distance"] > 0 and route["duration"] > 0
                report["routing"] = {"geometry_points": len(route["coordinates"]), "distance_km": route["distance"], "duration_seconds": route["duration"], "source": route["source"], "passed": True}
        timings, errors = [], []
        async def journey(role, index, actor):
            actions = [("/data/profiles", {"action": "select", "limit": 20}), ("/data/posts", {"action": "select", "limit": 20}), ("/data/bookings", {"action": "select", "limit": 20}), ("/data/conversations", {"action": "select", "limit": 20}), ("/data/notification_events", {"action": "select", "limit": 20})]
            for round_number in range(2):
                for path, body in actions:
                    started = time.perf_counter()
                    try:
                        response = await client.post(path, json=body, headers=headers(actor))
                        timings.append((time.perf_counter() - started) * 1000)
                        if response.status_code != 200:
                            errors.append({"role": role, "path": path, "status": response.status_code})
                    except httpx.HTTPError as error:
                        errors.append({"role": role, "path": path, "error": type(error).__name__})
        started = time.perf_counter()
        await asyncio.gather(*(journey(role, index, actor) for role in ["client", "photographer", "model"] for index, actor in enumerate(actors[role])))
        elapsed = time.perf_counter() - started
        timings.sort()
        report["load"] = {"simultaneous_sessions": 300, "roles": {"clients": 100, "photographers": 100, "models": 100}, "requests": len(timings), "errors": len(errors), "error_examples": errors[:10], "elapsed_seconds": round(elapsed, 2), "requests_per_second": round(len(timings) / elapsed, 2), "median_ms": round(statistics.median(timings), 2), "p95_ms": round(timings[int(len(timings) * .95) - 1], 2), "max_ms": round(max(timings), 2), "scope": "HTTP authenticated discovery/feed/bookings/chat inbox/notifications; no real-money or video load"}
        await write_load(client, actors)
        report["tested_scope_passed"] = not errors and not report["write_load"]["errors"] and report["async_worker"]["passed"]
        report["ready_for_public_launch"] = False
        report["unverified"] = ["Actual card checkout and gateway settlement", "Refund execution and bank payouts", "Real device push delivery", "Video media transport under 300-user load", "All screens on physical iOS/Android devices", "Identity verification operations", "Store review approval"]
    output = Path(os.getenv("QA_REPORT_PATH", "/artifacts/role-load-report.json"))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    if not report["tested_scope_passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        report["failure"] = {"type": type(error).__name__, "reason": str(error)[:1000]}
        report["ready_for_public_launch"] = False
        output = Path(os.getenv("QA_REPORT_PATH", "/artifacts/role-load-report.json"))
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2))
        raise
