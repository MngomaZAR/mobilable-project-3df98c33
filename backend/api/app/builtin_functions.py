import hashlib
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status

from .config import Settings
from .database import execute_table_query
from .local_auth import user_from_access_token
from .access_control import require_admin
from .payments import checkout
from .messaging import start_conversation, chat_messages


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












async def handle_for_you_ranking(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        limit = min(max(int(payload.get("limit") or 50), 1), 100)
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=400, detail="Invalid ranking limit.") from error
    posts = await select_rows(
        settings,
        "posts",
        "id, created_at, likes_count, comment_count",
        [{"op": "eq", "column": "moderation_status", "value": "approved"}, {"op": "is", "column": "is_locked", "value": False}],
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






def payfast_signature(params: dict[str, Any], passphrase: str | None = None) -> str:
    filtered = {key: str(value).strip() for key, value in params.items() if value is not None and str(value).strip()}
    query = urlencode(filtered)
    if passphrase:
        query = f"{query}&passphrase={passphrase.strip()}"
    return hashlib.md5(query.encode("utf-8")).hexdigest()




async def handle_payout_methods(settings: Settings, token: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    from .financial_operations import FinancialConfig, add_bank_method, list_bank_methods, set_default_bank_method, revoke_bank_method
    user = await require_user(settings, token)
    if (user.get('user_metadata') or {}).get('deletion_status') and payload.get('action', 'list') != 'list':
        raise HTTPException(status_code=409, detail='New bank changes are disabled while account deletion is pending.')
    action = payload.get("action") or "list"
    if action == "list":
        return {"methods": await list_bank_methods(settings, user)}
    if action == "add":
        return {"method": await add_bank_method(settings, FinancialConfig.from_env(), user, payload)}
    if action == "set_default":
        return {"method": await set_default_bank_method(settings, FinancialConfig.from_env(), user, payload.get('id'))}
    if action == "delete":
        return await revoke_bank_method(settings, user, payload.get('id'))
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported payout action: {action}")


async def handle_admin_review(settings: Settings, payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
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
        content = {table: await select_rows(settings, table, '*', [{"op": "eq", "column": "moderation_status", "value": "pending"}], limit=200) for table in ['posts', 'stories', 'post_comments', 'reviews']}
        return {"verifications": verifications, "payout_methods": payout_methods, "kyc_documents": kyc_documents, 'content': content}
    if action == "decide_verification":
        from .onboarding import decide_identity
        return await decide_identity(settings, str(payload.get("user_id") or ""), str(payload.get("decision") or ""))
    if action == "decide_payout":
        from .financial_operations import FinancialConfig, verify_bank_method, reject_bank_method
        if payload.get('decision') == 'rejected':
            return {'method': await reject_bank_method(settings, user, payload.get('payout_method_id'), payload.get('evidence_reference'))}
        return {'method': await verify_bank_method(settings, FinancialConfig.from_env(), user, payload.get('payout_method_id'), payload.get('evidence_reference'))}
    if action == "decide_kyc_document":
        from .onboarding import decide_document
        return await decide_document(settings, str(payload.get("document_id") or ""), str(payload.get("decision") or ""))
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported admin review action: {action}")








async def handle_builtin_function(settings: Settings, name: str, token: str | None, payload: dict[str, Any]) -> dict[str, Any] | None:
    if not settings.postgres_url:
        return None
    user = await require_user(settings, token)
    if (user.get('user_metadata') or {}).get('deletion_status') and name in {'recommendation-events', 'compliance-consent', 'dispatch-create'}:
        raise HTTPException(status_code=409, detail='New activity is disabled while account deletion is pending.')
    if name.startswith('dispatch-'):
        from .dispatch_engine import DispatchCreate, DispatchRespond, DispatchState, create_dispatch, respond_to_dispatch, get_dispatch_state
        from pydantic import ValidationError
        try:
            if name == 'dispatch-create':
                return await create_dispatch(settings, DispatchCreate.model_validate(payload), user)
            if name == 'dispatch-respond':
                return await respond_to_dispatch(settings, DispatchRespond.model_validate(payload), user)
            if name == 'dispatch-state':
                return await get_dispatch_state(settings, DispatchState.model_validate(payload).dispatch_request_id, user)
        except ValidationError:
            raise HTTPException(status_code=400, detail='Provide a valid booking-backed dispatch command.') from None
    if name == 'livekit-token':
        from .video_calls import handle_video_call
        return await handle_video_call(settings, user, payload)
    if name in {"eta", "heatmap", "status-leaderboard", "escrow-release", "send-app-email"}:
        raise HTTPException(status_code=503, detail="This service is not enabled for the scheduled-booking release.")
    if name == "admin-review":
        require_admin(settings, user)
        if payload.get("action", "").startswith("decide_") and payload.get("decision") not in {"approved", "rejected", "verified", "unverified"}:
            raise HTTPException(status_code=400, detail="Invalid review decision.")
    if name == "conversation-start":
        return await start_conversation(settings, user, payload)
    if name == "chat-messages":
        if payload.get('action', 'send') not in {'list', 'read', 'mark_read', 'delete'} and (user.get('user_metadata') or {}).get('deletion_status'):
            raise HTTPException(status_code=409, detail='New messages are disabled while account deletion is pending.')
        return await chat_messages(settings, user, payload)
    if name == "payfast-handler":
        return await checkout(settings, str(payload.get("booking_id") or ""), user)
    if name == "recommendation-events" and len(payload.get("events") or []) > 100:
        raise HTTPException(status_code=400, detail="Too many recommendation events.")
    handlers = {
        "for-you-ranking": lambda: handle_for_you_ranking(settings, payload),
        "recommendation-events": lambda: handle_recommendation_events(settings, token, payload),
        "compliance-consent": lambda: handle_compliance_consent(settings, token, payload),
        "payout-methods": lambda: handle_payout_methods(settings, token, payload),
        "admin-review": lambda: handle_admin_review(settings, payload, user),
    }
    handler = handlers.get(name)
    if not handler:
        return None
    return await handler()
