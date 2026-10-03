from copy import deepcopy
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException

from .config import Settings


PUBLIC_ROLES = {"client", "photographer", "model", "agency", "brand"}
PUBLIC_TABLES = {"profiles", "photographers", "models", "photographer_equipment", "posts", "stories", "post_comments", "post_likes", "reviews", "follows", "availability", "blocked_dates", "model_services", "status_scores", "subscription_tiers", "tip_goals"}
OWNER_COLUMNS = {
    "profiles": "id", "photographers": "id", "models": "id",
    "photographer_equipment": "photographer_id",
    "availability": "user_id", "blocked_dates": "user_id",
    "posts": "author_id", "stories": "author_id", "post_comments": "user_id", "post_likes": "user_id",
    "follows": "follower_id", "model_services": "model_id",
    "notification_events": "user_id", "notification_preferences": "user_id",
    "push_tokens": "user_id", "device_tokens": "user_id",
    "kyc_documents": "user_id", "support_tickets": "created_by",
    "account_deletion_requests": "created_by", "user_consents": "user_id",
    "consent_events": "user_id", "analytics_events": "user_id",
    "crash_logs": "user_id", "media_assets": "owner_id",
    "payout_methods": "user_id", "credits_wallets": "user_id",
    "credits_ledger": "user_id", "earnings": "user_id",
    "subscriptions": "subscriber_id", "subscription_tiers": "creator_id",
    "tip_goals": "creator_id", "post_bookmarks": "user_id",
    "user_blocks": "blocker_id", "reports": "created_by",
    "message_reactions": "user_id", "location_tracks": "user_id",
    "post_unlocks": "user_id", "media_access_logs": "user_id",
}
ADMIN_TABLES = {"moderation_cases", "policy_violations", "payment_incidents", "job_outbox", "booking_events", "payment_events", "payout_requests"}
READ_ONLY = {"credits_wallets", "credits_ledger", "earnings", "payments", "subscriptions", "status_scores", "eta_snapshots", "dispatch_requests", "dispatch_offers", "booking_events", "payment_events", "payout_requests", "reviews", "payout_methods", "message_reactions"}
READ_ONLY.add("kyc_documents")
READ_ONLY.add("post_unlocks")
READ_ONLY.add("post_likes")
READ_ONLY.add("post_comments")
READ_ONLY.add("reports")
READ_ONLY.add("account_deletion_requests")
INSERT_ONLY = {"analytics_events", "crash_logs", "consent_events", "account_deletion_requests", "reports"}
INSERT_ONLY.add("media_access_logs")
PROFILE_WRITE_FIELDS = {"id", "role", "full_name", "name", "bio", "avatar_url", "city", "province", "country", "phone", "contact_details", "latitude", "longitude", "availability_status", "privacy", "preferences", "updated_at", "username", "instagram", "website", "gender", "push_token", "is_model", "is_photographer", "kyc_status"}
PUBLIC_PROFILE_FIELDS = {"id", "role", "full_name", "name", "bio", "avatar_url", "city", "province", "country", "verified", "kyc_status", "age_verified", "availability_status", "created_at", "username", "website", "instagram"}
VALID_FILTER_OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "contains", "or", "match", "ilike"}
MODEL_SERVICE_TYPES = {"brand_ambassador", "product_shoot", "event_hosting", "social_promo", "fashion_shoot", "music_video", "film_extra"}
SERVICE_SCOPE = '"model_services"."service_type" IN (' + ','.join("'" + value + "'" for value in sorted(MODEL_SERVICE_TYPES)) + ')'
EQUIPMENT_WRITE_FIELDS = {"photographer_id", "tier_id", "camera_body", "lenses", "lighting", "extras", "updated_at"}


def is_admin(settings: Settings, user: dict[str, Any] | None) -> bool:
    allowed = {value.strip() for value in settings.admin_user_ids.split(",") if value.strip()}
    return bool(user and user.get("id") in allowed)


def require_admin(settings: Settings, user: dict[str, Any] | None) -> None:
    if not is_admin(settings, user):
        raise HTTPException(status_code=403, detail="Administrator access is required.")


def authorize_query(
    settings: Settings, table: str, request: dict[str, Any], user: dict[str, Any] | None
) -> tuple[dict[str, Any], tuple[str, list[Any]] | None]:
    payload = deepcopy(request)
    action = payload.get("action", "select")
    if action != 'select' and user and (user.get('user_metadata') or {}).get('deletion_status'):
        raise HTTPException(status_code=409, detail='Account deletion is pending; new content and profile changes are disabled.')
    if action not in {"select", "insert", "upsert", "update", "delete"}:
        raise HTTPException(status_code=400, detail="Unsupported data action.")
    if table not in PUBLIC_TABLES | set(OWNER_COLUMNS) | ADMIN_TABLES | {"bookings", "payments", "conversations", "conversation_participants", "messages", "status_scores", "eta_snapshots", "dispatch_requests", "dispatch_offers"}:
        raise HTTPException(status_code=403, detail="This table is not exposed by the application API.")
    for item in payload.get("filters") or []:
        if not isinstance(item, dict) or item.get("op") not in VALID_FILTER_OPS:
            raise HTTPException(status_code=400, detail="Invalid data filter.")
    if not user:
        if action != "select" or table not in PUBLIC_TABLES:
            raise HTTPException(status_code=401, detail="Authentication is required.")
    if action != 'select' and table in {'posts', 'stories', 'post_comments', 'reviews'}:
        rows = payload.get('payload') or {}
        rows = rows if isinstance(rows, list) else [rows]
        if any(isinstance(row, dict) and 'moderation_status' in row for row in rows):
            raise HTTPException(status_code=403, detail='Use the audited moderation command, including a decision reason.')
    if is_admin(settings, user):
        # Financial records and booking states still go through domain commands.
        if action == "select" or (table not in READ_ONLY and table != "bookings"):
            return payload, None
    if table in ADMIN_TABLES:
        require_admin(settings, user)
    if action != "select" and table in READ_ONLY:
        raise HTTPException(status_code=403, detail="This record is managed by the server.")
    if action != "select" and table == "bookings":
        raise HTTPException(status_code=403, detail="Use the booking service to change bookings.")
    if table in INSERT_ONLY and action not in {"select", "insert"}:
        raise HTTPException(status_code=403, detail="This record is append-only.")
    actor = str(user["id"]) if user else ""
    scope = None
    if table == "profiles" and action == "select":
        scope = ("coalesce(profiles.deletion_status,'') NOT IN ('processing','completed')", [])
        own_only = bool(actor and any(item.get("op") == "eq" and item.get("column") == "id" and item.get("value") == actor for item in payload.get("filters") or []))
        if not own_only:
            for item in payload.get("filters") or []:
                fields = set((item.get("value") or {}).keys()) if item.get("op") == "match" else {item.get("column")}
                if item.get("op") == "or":
                    fields = {part.split(".", 1)[0].strip() for part in str(item.get("value")).split(",")}
                if not fields <= PUBLIC_PROFILE_FIELDS:
                    raise HTTPException(status_code=403, detail="Private profile fields cannot be searched.")
            if any(item.get("column") not in PUBLIC_PROFILE_FIELDS for item in payload.get("order") or []):
                raise HTTPException(status_code=403, detail="Private profile fields cannot be sorted.")
        if payload.get("select") and payload["select"] != "*" and "id" not in payload["select"].split(","):
            payload["select"] += ",id"
    if table == "reviews" and not is_admin(settings, user):
        scope = ('"moderation_status" = \'approved\' OR "client_id"::text = $1', [actor])
    if table == "posts" and action == "select":
        scope = ("(moderation_status='approved' AND coalesce(is_locked,false)=false) OR author_id=$1", [actor])
    if table == 'stories' and action == 'select':
        scope = ("(moderation_status='approved' AND expires_at>now()) OR author_id=$1", [actor])
    if table == 'post_comments' and action == 'select':
        scope = ("EXISTS (SELECT 1 FROM posts p WHERE p.id=post_comments.post_id AND ((p.moderation_status='approved' AND coalesce(p.is_locked,false)=false) OR p.author_id=$1)) AND (post_comments.moderation_status='approved' OR post_comments.user_id=$1)", [actor])
    if table == "bookings":
        scope = ('"bookings"."client_id"::text = $1 OR "bookings"."photographer_id"::text = $1 OR "bookings"."model_id"::text = $1', [actor])
    elif table == "payments":
        scope = ('"payments"."booking_id"::text IN (SELECT id::text FROM bookings WHERE client_id::text = $1 OR photographer_id::text = $1 OR model_id::text = $1)', [actor])
    elif table in {"conversations", "conversation_participants", "messages"}:
        if action in {"insert", "upsert", "delete"}:
            raise HTTPException(status_code=403, detail="Use the messaging service for this action.")
        identifier = "id" if table == "conversations" else "conversation_id"
        scope = (f'"{table}"."{identifier}"::text IN (SELECT conversation_id::text FROM conversation_participants WHERE user_id::text = $1)', [actor])
        scope = (scope[0] + f' AND NOT EXISTS(SELECT 1 FROM conversation_participants other JOIN user_blocks b ON (b.blocker_id=$1 AND b.blocked_id=other.user_id) OR (b.blocked_id=$1 AND b.blocker_id=other.user_id) WHERE other.conversation_id::text="{table}"."{identifier}"::text)', [actor])
        if action == "update":
            fields = set(payload.get("payload") or {})
            allowed = {"read_at"} if table == "messages" else set()
            if not fields <= allowed:
                raise HTTPException(status_code=403, detail="Use the messaging service to edit messages.")
            scope = (scope[0] + ' AND "sender_id"::text <> $1', [actor])
    elif table == 'message_reactions' and action == 'select':
        scope = ('message_id IN (SELECT m.id FROM messages m JOIN conversation_participants p ON p.conversation_id=m.conversation_id WHERE p.user_id=$1 AND m.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM conversation_participants other JOIN user_blocks b ON (b.blocker_id=$1 AND b.blocked_id=other.user_id) OR (b.blocked_id=$1 AND b.blocker_id=other.user_id) WHERE other.conversation_id=m.conversation_id))', [actor])
    elif table == 'location_tracks':
        if action != 'select':
            raise HTTPException(status_code=403, detail='Use the booking location command.')
        scope = ("created_at>now()-interval '5 minutes' AND booking_id IN (SELECT id FROM bookings WHERE (client_id=$1 OR photographer_id=$1 OR model_id=$1) AND payment_status='paid' AND status IN ('accepted','in_progress') AND now()>=start_datetime-interval '2 hours' AND now()<end_datetime)", [actor])
    elif table in {"eta_snapshots", "dispatch_requests", "dispatch_offers"}:
        booking_expression = '"booking_id"::text' if table != "dispatch_offers" else '(SELECT booking_id::text FROM dispatch_requests WHERE id::text = "dispatch_offers"."dispatch_request_id"::text)'
        scope = (f'{booking_expression} IN (SELECT id::text FROM bookings WHERE client_id::text = $1 OR photographer_id::text = $1 OR model_id::text = $1)', [actor])
    elif table == "status_scores":
        pass
    elif action != "select" or table not in PUBLIC_TABLES:
        owner = OWNER_COLUMNS.get(table)
        if not owner:
            raise HTTPException(status_code=403, detail="This action is not available.")
        scope = (f'"{table}"."{owner}"::text = $1', [actor])
        rows = payload.get("payload")
        if action in {"insert", "upsert"}:
            rows = rows if isinstance(rows, list) else [rows]
            if len(rows) > 100:
                raise HTTPException(status_code=400, detail="Too many records in one request.")
            for row in rows:
                if not isinstance(row, dict):
                    raise HTTPException(status_code=400, detail="Invalid record.")
                if row.get(owner) not in {None, actor}:
                    raise HTTPException(status_code=403, detail="Cannot write another user's record.")
                row[owner] = actor
        elif action == "update" and owner in (payload.get("payload") or {}):
            if payload["payload"][owner] != actor:
                raise HTTPException(status_code=403, detail="Record ownership cannot be changed.")
    if table == "model_services":
        scope = ((scope[0] + ' AND ' if scope else '') + SERVICE_SCOPE, scope[1] if scope else [])
    if action != "select":
        rows = payload.get("payload")
        rows = rows if isinstance(rows, list) else [rows or {}]
        for row in rows:
            if table == "photographer_equipment":
                if not set(row) <= EQUIPMENT_WRITE_FIELDS:
                    raise HTTPException(status_code=400, detail="Unsupported equipment field.")
                if "tier_id" in row and row["tier_id"] not in {"essential", "standard", "professional", "premium", "studio"}:
                    raise HTTPException(status_code=400, detail="Invalid equipment tier.")
                for field in {"lenses", "extras"} & set(row):
                    values = row[field]
                    if not isinstance(values, list) or len(values) > 50 or any(not isinstance(value, str) or len(value) > 100 for value in values):
                        raise HTTPException(status_code=400, detail=f"{field} must be an array of equipment names.")
                if "camera_body" in row and (not isinstance(row["camera_body"], str) or not row["camera_body"].strip() or len(row["camera_body"]) > 500):
                    raise HTTPException(status_code=400, detail="A camera body is required.")
            if table == "model_services":
                if not set(row) <= {"model_id", "service_type", "rate_zar", "is_active", "requires_age_verification", "updated_at"}:
                    raise HTTPException(status_code=400, detail="Unsupported model service field.")
                if row.get("requires_age_verification") or ("service_type" in row and row["service_type"] not in MODEL_SERVICE_TYPES):
                    raise HTTPException(status_code=403, detail="This model service is not supported by the marketplace.")
                if action in {"insert", "upsert"} and row.get("service_type") not in MODEL_SERVICE_TYPES:
                    raise HTTPException(status_code=400, detail="A supported service type is required.")
                if "rate_zar" in row:
                    try:
                        rate = Decimal(str(row["rate_zar"]))
                    except (InvalidOperation, TypeError, ValueError):
                        raise HTTPException(status_code=400, detail="Invalid service rate.")
                    if not rate.is_finite() or not Decimal("0") < rate <= Decimal("100000"):
                        raise HTTPException(status_code=400, detail="Service rates must be positive and at most R100000.")
            if table in {"photographers", "models"} and set(row) & {"verified", "kyc_status", "age_verified", "rating", "rating_count", "review_count", "total_bookings", "total_earnings"}:
                raise HTTPException(status_code=403, detail="Creator ratings and verification are managed by the server.")
            if table in {"posts", "stories"} and set(row) & {"likes_count", "comment_count", "view_count", "moderation_status"}:
                raise HTTPException(status_code=403, detail="Engagement and moderation are managed by the server.")
            if table in {'posts', 'stories'}:
                if row.get("is_locked") or row.get("price_zar"):
                    raise HTTPException(status_code=409, detail="Digital post sales are not enabled.")
                if action in {"insert", "upsert", "update"}:
                    row["moderation_status"] = "pending"
            if table == "notification_events" and action != "delete" and (set(row) - {"read_at", "status"} or row.get("status") not in {None, "read", "dismissed"}):
                raise HTTPException(status_code=403, detail="Only notification read state can be changed.")
            if table == "profiles":
                if 'role' in row and action in {'update', 'upsert'}:
                    raise HTTPException(status_code=403, detail='Account role cannot be changed through profile updates.')
                if not set(row) <= PROFILE_WRITE_FIELDS or (row.get("role") and row["role"] not in PUBLIC_ROLES):
                    raise HTTPException(status_code=403, detail="Profile verification and privileges are managed by administrators.")
                if row.get("kyc_status") not in {None, "pending", "submitted"}:
                    raise HTTPException(status_code=403, detail="KYC approval requires administrator review.")
            if table == "kyc_documents" and row.get("status") not in {None, "pending", "submitted"}:
                raise HTTPException(status_code=403, detail="KYC decisions require administrator review.")
    return payload, scope


def redact_result(settings: Settings, table: str, result: dict[str, Any], user: dict[str, Any] | None) -> dict[str, Any]:
    if table != "profiles" or is_admin(settings, user):
        return result
    actor = user.get("id") if user else None
    def redact(row: Any) -> Any:
        if not isinstance(row, dict) or (actor and row.get("id") == actor):
            return row
        return {key: value for key, value in row.items() if key in PUBLIC_PROFILE_FIELDS}
    data = result.get("data")
    return {**result, "data": [redact(row) for row in data] if isinstance(data, list) else redact(data)}
