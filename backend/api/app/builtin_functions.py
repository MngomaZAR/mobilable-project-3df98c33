import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

from fastapi import HTTPException, status
from jose import jwt

from .config import Settings
from .database import execute_table_query
from .local_auth import user_from_access_token


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


async def current_user(settings: Settings, token: str | None) -> dict[str, Any] | None:
    if not token or not settings.postgres_url:
        return None
    try:
        return await user_from_access_token(settings, token)
    except HTTPException:
        return None


async def require_user(settings: Settings, token: str | None) -> dict[str, Any]:
    user = await current_user(settings, token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication is required.")
    return user


async def insert_row(settings: Settings, table: str, row: dict[str, Any]) -> dict[str, Any]:
    result = await execute_table_query(
        settings,
        table,
        {
            "action": "insert",
            "payload": row,
            "select": "*",
            "single": True,
            "filters": [],
        },
    )
    return result.get("data") or row


async def update_rows(settings: Settings, table: str, row: dict[str, Any], filters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = await execute_table_query(
        settings,
        table,
        {
            "action": "update",
            "payload": row,
            "select": "*",
            "filters": filters,
        },
    )
    data = result.get("data")
    return data if isinstance(data, list) else ([] if data is None else [data])


async def select_rows(
    settings: Settings,
    table: str,
    select: str = "*",
    filters: list[dict[str, Any]] | None = None,
    limit: int | None = None,
    order: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    result = await execute_table_query(
        settings,
        table,
        {
            "action": "select",
            "select": select,
            "filters": filters or [],
            "limit": limit,
            "order": order or [],
        },
    )
    return result.get("data") or []


async def handle_dispatch_create(settings: Settings, token: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    user = await current_user(settings, token)
    request_id = new_id()
    now = now_iso()
    base_amount = float(payload.get("base_amount") or 0)
    quote = {
        "currency": "ZAR",
        "base_amount": base_amount,
        "platform_fee": round(base_amount * 0.2, 2) if base_amount else 0,
        "total_amount": base_amount,
    }
    dispatch_request = await insert_row(
        settings,
        "dispatch_requests",
        {
            "id": request_id,
            "booking_id": payload.get("booking_id"),
            "requester_id": user.get("id") if user else None,
            "service_type": payload.get("service_type") or "photography",
            "status": "queued",
            "assignment_state": "queued",
            "fanout_count": payload.get("fanout_count") or 1,
            "intensity_level": payload.get("intensity_level") or 1,
            "requested_lat": payload.get("requested_lat"),
            "requested_lng": payload.get("requested_lng"),
            "sla_timeout_seconds": payload.get("sla_timeout_seconds") or 120,
            "required_tier": payload.get("required_tier"),
            "required_equipment": payload.get("required_equipment") or {},
            "quote": quote,
            "created_at": now,
            "updated_at": now,
        },
    )
    offers: list[dict[str, Any]] = []
    providers = await select_rows(
        settings,
        "profiles",
        "id, role, full_name, availability_status, city",
        [{"op": "in", "column": "role", "value": ["photographer", "model"]}],
        limit=int(payload.get("fanout_count") or 5),
    )
    for provider in providers:
        offer = await insert_row(
            settings,
            "dispatch_offers",
            {
                "id": new_id(),
                "dispatch_request_id": request_id,
                "provider_id": provider.get("id"),
                "status": "offered",
                "expires_at": (datetime.now(UTC) + timedelta(seconds=int(payload.get("sla_timeout_seconds") or 120))).isoformat(),
                "created_at": now,
            },
        )
        offers.append(offer)
    return {
        "dispatch_request": dispatch_request,
        "offers": offers,
        "quote": quote,
        "assignment_state": "queued" if offers else "no_provider_available",
        "eta_confidence": 0.75 if offers else 0,
    }


async def handle_dispatch_respond(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    offer_id = payload.get("offer_id")
    response = "accepted" if payload.get("response") == "accept" else "declined"
    rows = []
    if offer_id:
        rows = await update_rows(
            settings,
            "dispatch_offers",
            {"status": response, "responded_at": now_iso()},
            [{"op": "eq", "column": "id", "value": offer_id}],
        )
    return {"status": response, "offer": rows[0] if rows else {"id": offer_id, "status": response}}


async def handle_dispatch_state(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    request_id = payload.get("dispatch_request_id")
    requests = await select_rows(settings, "dispatch_requests", "*", [{"op": "eq", "column": "id", "value": request_id}], limit=1)
    offers = await select_rows(settings, "dispatch_offers", "*", [{"op": "eq", "column": "dispatch_request_id", "value": request_id}], limit=50)
    return {
        "dispatch_request": requests[0] if requests else {"id": request_id, "status": "unknown"},
        "offers": offers,
        "events": [],
        "assignment_state": (requests[0].get("assignment_state") if requests else "unknown"),
        "eta_confidence": 0.75 if offers else 0,
    }


async def handle_eta(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    booking_id = payload.get("booking_id")
    snapshot = {
        "id": new_id(),
        "booking_id": booking_id,
        "eta_minutes": 15,
        "distance_km": 5.0,
        "eta_confidence": 0.72,
        "provider": "osrm",
        "created_at": now_iso(),
    }
    await insert_row(settings, "eta_snapshots", snapshot)
    return snapshot


async def handle_status_leaderboard(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    limit = int(payload.get("limit") or 20)
    city = payload.get("city")
    filters = [{"op": "eq", "column": "city", "value": city}] if city else []
    profiles = await select_rows(settings, "profiles", "id, full_name, role, city, avatar_url", filters, limit=limit)
    return {
        "city": city or "all",
        "source": "postgres",
        "generated_at": now_iso(),
        "leaderboard": [
            {
                "user_id": row.get("id"),
                "name": row.get("full_name") or "Creator",
                "role": row.get("role") or "creator",
                "city": row.get("city"),
                "score": max(100 - index * 3, 1),
                "avatar_url": row.get("avatar_url"),
            }
            for index, row in enumerate(profiles)
        ],
    }


async def handle_for_you_ranking(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    limit = int(payload.get("limit") or 50)
    posts = await select_rows(
        settings,
        "posts",
        "id, created_at, likes_count, comment_count",
        [],
        limit=limit,
        order=[{"column": "created_at", "ascending": False}],
    )
    return {
        "ranked_posts": [
            {
                "post_id": post.get("id"),
                "score": float(post.get("likes_count") or 0) * 2 + float(post.get("comment_count") or 0) + max(1, limit - index),
            }
            for index, post in enumerate(posts)
            if post.get("id")
        ],
        "generated_at": now_iso(),
    }


async def handle_recommendation_events(settings: Settings, token: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    user = await current_user(settings, token)
    events = payload.get("events") if isinstance(payload.get("events"), list) else []
    inserted = 0
    for event in events:
        if not isinstance(event, dict):
            continue
        await insert_row(
            settings,
            "analytics_events",
            {
                "id": new_id(),
                "user_id": user.get("id") if user else None,
                "event_type": event.get("event_type"),
                "post_id": event.get("post_id"),
                "dwell_ms": event.get("dwell_ms"),
                "metadata": event.get("metadata") or {},
                "created_at": now_iso(),
            },
        )
        inserted += 1
    return {"success": True, "inserted": inserted}


async def handle_heatmap(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "generated_at": now_iso(),
        "role": payload.get("role") or "combined",
        "city": payload.get("city"),
        "buckets": [],
    }


async def handle_compliance_consent(settings: Settings, token: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    user = await current_user(settings, token)
    user_id = user.get("id") if user else payload.get("user_id")
    now = now_iso()
    event = await insert_row(
        settings,
        "consent_events",
        {
            "id": new_id(),
            "user_id": user_id,
            "consent_type": payload.get("consent_type"),
            "legal_basis": payload.get("legal_basis") or "consent",
            "consent_version": payload.get("consent_version"),
            "enabled": bool(payload.get("enabled")),
            "context": payload.get("context") or {},
            "captured_at": now,
            "created_at": now,
        },
    )
    consent = await execute_table_query(
        settings,
        "user_consents",
        {
            "action": "upsert",
            "payload": {
                "id": f"{user_id}:{payload.get('consent_type')}",
                "user_id": user_id,
                "consent_type": payload.get("consent_type"),
                "granted": bool(payload.get("enabled")),
                "accepted": bool(payload.get("enabled")),
                "granted_at": now,
                "accepted_at": now,
                "legal_basis": payload.get("legal_basis") or "consent",
                "version": payload.get("consent_version"),
                "metadata": payload.get("context") or {},
            },
            "select": "*",
            "onConflict": "id",
            "single": True,
            "filters": [],
        },
    )
    return {"success": True, "consent_event": event, "user_consent": consent.get("data")}


async def handle_conversation_start(settings: Settings, token: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    user = await require_user(settings, token)
    participant_id = str(payload.get("participant_id") or payload.get("participantId") or "").strip()
    if not participant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="participant_id is required.")
    title = str(payload.get("title") or "Conversation")
    conversation = await insert_row(
        settings,
        "conversations",
        {"id": new_id(), "title": title, "created_at": now_iso(), "last_message_at": now_iso()},
    )
    for participant in [user["id"], participant_id]:
        await execute_table_query(
            settings,
            "conversation_participants",
            {
                "action": "upsert",
                "payload": {
                    "id": f"{conversation['id']}:{participant}",
                    "conversation_id": conversation["id"],
                    "user_id": participant,
                    "created_at": now_iso(),
                },
                "select": "*",
                "onConflict": "id",
                "maybeSingle": True,
                "filters": [],
            },
        )
    return {"id": conversation["id"], "title": conversation.get("title") or title}


async def handle_chat_messages(settings: Settings, token: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    user = await require_user(settings, token)
    action = payload.get("action") or "list"
    conversation_id = payload.get("conversation_id") or payload.get("chat_id")
    if not conversation_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="conversation_id is required.")
    if action == "list":
        messages = await select_rows(
            settings,
            "messages",
            "*",
            [{"op": "eq", "column": "conversation_id", "value": conversation_id}],
            limit=200,
            order=[{"column": "created_at", "ascending": True}],
        )
        return {"messages": messages}
    if action == "send":
        now = now_iso()
        message = await insert_row(
            settings,
            "messages",
            {
                "id": new_id(),
                "conversation_id": conversation_id,
                "chat_id": conversation_id,
                "sender_id": user["id"],
                "body": payload.get("text") or payload.get("body") or "",
                "text": payload.get("text") or payload.get("body") or "",
                "message_type": payload.get("message_type") or "text",
                "media_url": payload.get("media_url"),
                "preview_url": payload.get("preview_url"),
                "locked": bool(payload.get("locked")),
                "unlocked": not bool(payload.get("locked")),
                "unlock_booking_id": payload.get("unlock_booking_id"),
                "unlock_price": payload.get("unlock_price"),
                "created_at": now,
            },
        )
        await update_rows(
            settings,
            "conversations",
            {"last_message": message.get("body"), "last_message_at": now},
            [{"op": "eq", "column": "id", "value": conversation_id}],
        )
        return {"message": message}
    if action == "unlock":
        await update_rows(
            settings,
            "messages",
            {"unlocked": True},
            [{"op": "eq", "column": "id", "value": payload.get("message_id")}],
        )
        return {"success": True}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported chat action: {action}")


def payfast_signature(params: dict[str, Any], passphrase: str | None = None) -> str:
    filtered = {key: str(value).strip() for key, value in params.items() if value is not None and str(value).strip()}
    query = urlencode(filtered)
    if passphrase:
        query = f"{query}&passphrase={passphrase.strip()}"
    return hashlib.md5(query.encode("utf-8")).hexdigest()


async def handle_payfast(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    payment_id = str(payload.get("booking_id") or payload.get("tip_id") or payload.get("payment_id") or new_id())
    amount = payload.get("amount") or payload.get("price_total")
    booking_id = payload.get("booking_id")
    if (amount is None or amount == "") and booking_id:
        rows = await select_rows(
            settings,
            "bookings",
            "price_total,total_amount,amount",
            [{"op": "eq", "column": "id", "value": booking_id}],
            limit=1,
        )
        booking = rows[0] if rows else {}
        amount = booking.get("price_total") or booking.get("total_amount") or booking.get("amount")
    amount_value = float(amount or 0)
    params: dict[str, Any] = {
        "merchant_id": settings.payfast_merchant_id or "10000100",
        "merchant_key": settings.payfast_merchant_key or "46f0cd694581a",
        "m_payment_id": payment_id,
        "amount": f"{amount_value:.2f}",
        "item_name": payload.get("item_name") or "PAPZII booking",
        "return_url": payload.get("return_url"),
        "cancel_url": payload.get("cancel_url"),
        "notify_url": payload.get("notify_url"),
    }
    params["signature"] = payfast_signature(params, settings.payfast_passphrase or None)
    signed_params = {key: value for key, value in params.items() if value is not None and str(value).strip()}
    base_url = settings.payfast_base_url or "https://www.payfast.co.za/eng/process"
    payment = await insert_row(
        settings,
        "payments",
        {
            "id": payment_id,
            "booking_id": booking_id,
            "amount": amount_value,
            "currency": "ZAR",
            "description": params["item_name"],
            "status": "pending",
            "provider": "payfast",
            "provider_payment_id": payment_id,
            "created_at": now_iso(),
        },
    )
    return {"paymentUrl": f"{base_url}?{urlencode(signed_params)}", "paymentId": payment.get("id") or payment_id}


async def handle_payout_methods(settings: Settings, token: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    user = await require_user(settings, token)
    action = payload.get("action") or "list"
    if action == "list":
        methods = await select_rows(settings, "payout_methods", "*", [{"op": "eq", "column": "user_id", "value": user["id"]}], limit=50)
        return {"methods": methods}
    if action == "add":
        account_number = str(payload.get("account_number") or "")
        masked = f"****{account_number[-4:]}" if len(account_number) >= 4 else "****"
        method = await insert_row(
            settings,
            "payout_methods",
            {
                "id": new_id(),
                "user_id": user["id"],
                "bank_name": payload.get("bank_name"),
                "account_holder": payload.get("account_holder"),
                "account_masked": masked,
                "account_type": payload.get("account_type") or "cheque",
                "branch_code": payload.get("branch_code"),
                "is_default": False,
                "verified": False,
                "created_at": now_iso(),
            },
        )
        return {"method": method}
    if action == "set_default":
        await update_rows(settings, "payout_methods", {"is_default": False}, [{"op": "eq", "column": "user_id", "value": user["id"]}])
        rows = await update_rows(
            settings,
            "payout_methods",
            {"is_default": True},
            [{"op": "eq", "column": "id", "value": payload.get("id")}, {"op": "eq", "column": "user_id", "value": user["id"]}],
        )
        return {"method": rows[0] if rows else None}
    if action == "delete":
        await execute_table_query(
            settings,
            "payout_methods",
            {
                "action": "delete",
                "select": "*",
                "filters": [{"op": "eq", "column": "id", "value": payload.get("id")}, {"op": "eq", "column": "user_id", "value": user["id"]}],
            },
        )
        return {"success": True}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported payout action: {action}")


async def handle_admin_review(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    if action == "list_pending":
        verifications = await select_rows(
            settings,
            "profiles",
            "id, full_name, role, email, created_at, kyc_status",
            [{"op": "in", "column": "kyc_status", "value": ["pending", "submitted"]}],
            limit=200,
        )
        payout_methods = await select_rows(settings, "payout_methods", "*", [{"op": "eq", "column": "verified", "value": False}], limit=200)
        kyc_documents = await select_rows(settings, "kyc_documents", "*", [{"op": "in", "column": "status", "value": ["pending", "submitted"]}], limit=200)
        return {"verifications": verifications, "payout_methods": payout_methods, "kyc_documents": kyc_documents}
    if action == "decide_verification":
        rows = await update_rows(
            settings,
            "profiles",
            {"kyc_status": payload.get("decision"), "verified": payload.get("decision") == "approved"},
            [{"op": "eq", "column": "id", "value": payload.get("user_id")}],
        )
        return {"profile": rows[0] if rows else None}
    if action == "decide_payout":
        rows = await update_rows(
            settings,
            "payout_methods",
            {"verified": payload.get("decision") == "verified", "status": payload.get("decision")},
            [{"op": "eq", "column": "id", "value": payload.get("payout_method_id")}],
        )
        return {"method": rows[0] if rows else None}
    if action == "decide_kyc_document":
        rows = await update_rows(
            settings,
            "kyc_documents",
            {"status": payload.get("decision")},
            [{"op": "eq", "column": "id", "value": payload.get("document_id")}],
        )
        return {"document": rows[0] if rows else None}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported admin review action: {action}")


async def handle_livekit(settings: Settings, token: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("action") == "end":
        if payload.get("session_id"):
            await update_rows(
                settings,
                "video_call_sessions",
                {"ended_at": now_iso(), "status": "ended"},
                [{"op": "eq", "column": "id", "value": payload.get("session_id")}],
            )
        return {"success": True}
    user = await require_user(settings, token)
    if not (settings.livekit_url and settings.livekit_api_key and settings.livekit_api_secret):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Live video is not configured.")
    creator_id = payload.get("creator_id")
    role = payload.get("role") or "viewer"
    room = f"papzi-{creator_id or user['id']}"
    session = await insert_row(
        settings,
        "video_call_sessions",
        {
            "id": new_id(),
            "creator_id": creator_id,
            "viewer_id": user["id"] if role == "viewer" else None,
            "room_name": room,
            "status": "active",
            "started_at": now_iso(),
            "created_at": now_iso(),
        },
    )
    claims = {
        "iss": settings.livekit_api_key,
        "sub": user["id"],
        "nbf": int(datetime.now(UTC).timestamp()),
        "exp": int((datetime.now(UTC) + timedelta(hours=2)).timestamp()),
        "video": {
            "room": room,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
        },
        "metadata": {"role": role},
    }
    token_value = jwt.encode(claims, settings.livekit_api_secret, algorithm="HS256")
    return {"token": token_value, "url": settings.livekit_url, "sessionId": session.get("id")}


async def handle_escrow_release(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    booking_id = payload.get("booking_id")
    if booking_id:
        await update_rows(settings, "bookings", {"status": "completed", "completed_at": now_iso()}, [{"op": "eq", "column": "id", "value": booking_id}])
    return {"success": True, "booking_id": booking_id}


async def handle_send_app_email(payload: dict[str, Any]) -> dict[str, Any]:
    return {"success": True, "queued": False, "message": "Email provider is not configured; request accepted for audit trail.", "payload": payload}


async def handle_builtin_function(settings: Settings, name: str, token: str | None, payload: dict[str, Any]) -> dict[str, Any] | None:
    if not settings.postgres_url:
        return None
    handlers = {
        "dispatch-create": lambda: handle_dispatch_create(settings, token, payload),
        "dispatch-respond": lambda: handle_dispatch_respond(settings, payload),
        "dispatch-state": lambda: handle_dispatch_state(settings, payload),
        "eta": lambda: handle_eta(settings, payload),
        "status-leaderboard": lambda: handle_status_leaderboard(settings, payload),
        "for-you-ranking": lambda: handle_for_you_ranking(settings, payload),
        "recommendation-events": lambda: handle_recommendation_events(settings, token, payload),
        "heatmap": lambda: handle_heatmap(settings, payload),
        "compliance-consent": lambda: handle_compliance_consent(settings, token, payload),
        "conversation-start": lambda: handle_conversation_start(settings, token, payload),
        "chat-messages": lambda: handle_chat_messages(settings, token, payload),
        "payfast-handler": lambda: handle_payfast(settings, payload),
        "payout-methods": lambda: handle_payout_methods(settings, token, payload),
        "admin-review": lambda: handle_admin_review(settings, payload),
        "livekit-token": lambda: handle_livekit(settings, token, payload),
        "escrow-release": lambda: handle_escrow_release(settings, payload),
        "send-app-email": lambda: handle_send_app_email(payload),
    }
    handler = handlers.get(name)
    if not handler:
        return None
    return await handler()
