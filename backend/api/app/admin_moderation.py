import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .access_control import require_admin
from .auth import bearer
from .config import Settings, get_settings
from .database import connect
from .storage import signed_url


router = APIRouter(prefix="/admin/moderation", tags=["admin-moderation"])
CONTENT_COLUMNS = {
    "posts": "id,author_id,caption,media_url,image_url,media_type,is_locked,moderation_status,created_at,updated_at",
    "stories": "id,author_id,media_url,media_type,expires_at,moderation_status,created_at,updated_at",
    "post_comments": "id,post_id,user_id,author_id,body,moderation_status,created_at,updated_at",
    "reviews": "id,booking_id,client_id,reviewer_id,reviewee_id,photographer_id,rating,comment,status,moderation_status,created_at,updated_at",
}


class ContentDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    table: Literal["posts", "stories", "post_comments", "reviews"]
    id: str = Field(min_length=1, max_length=120)
    decision: Literal["approved", "rejected"]
    reason: str = Field(min_length=3, max_length=1000)
    expected_status: Literal["pending", "approved", "rejected"] = "pending"

    @field_validator("id", "reason")
    @classmethod
    def no_control_characters(cls, value):
        if any(ord(character) < 32 and character not in "\n\t" for character in value):
            raise ValueError("Control characters are not allowed.")
        return value


def authorize_admin(settings, user):
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication is required.")
    require_admin(settings, user)


async def admin_user(
    settings: Annotated[Settings, Depends(get_settings)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
):
    from .builtin_functions import require_user

    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    user = await require_user(settings, credentials.credentials)
    authorize_admin(settings, user)
    return user


async def list_pending_content(settings: Settings, user):
    authorize_admin(settings, user)
    conn = await connect(settings)
    try:
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            content = {}
            for table, columns in CONTENT_COLUMNS.items():
                rows = await conn.fetch(
                    f"SELECT {columns} FROM {table} WHERE coalesce(moderation_status,'pending')='pending' ORDER BY created_at,id LIMIT 200"
                )
                content[table] = [dict(row) for row in rows]
            counts = {}
            for table in CONTENT_COLUMNS:
                counts[table] = await conn.fetchval(
                    f"SELECT count(*) FROM {table} WHERE coalesce(moderation_status,'pending')='pending'"
                )
            return {"content": content, "counts": counts, "limit_per_type": 200}
    finally:
        await conn.close()


async def audit_decision(conn, actor, table, row, decision, reason, parent_event_id=None):
    event_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO content_moderation_events
        (id,admin_user_id,content_table,content_id,previous_status,decision,reason,parent_event_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
        event_id, actor, table, row["id"], row["moderation_status"] or "pending", decision, reason, parent_event_id,
    )
    return event_id


async def review_content(settings: Settings, user, command: ContentDecision):
    authorize_admin(settings, user)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            parent = None
            # Lock parents before children, including when rejecting, to serialize against parent rejection.
            if command.table in {"post_comments", "reviews"}:
                parent_column = "post_id" if command.table == "post_comments" else "booking_id"
                parent_table = "posts" if command.table == "post_comments" else "bookings"
                child = await conn.fetchrow(f"SELECT {parent_column} FROM {command.table} WHERE id=$1", command.id)
                if not child:
                    raise HTTPException(status_code=404, detail="Content not found.")
                parent = await conn.fetchrow(f"SELECT * FROM {parent_table} WHERE id=$1 FOR UPDATE", child[parent_column])
            row = await conn.fetchrow(f"SELECT * FROM {command.table} WHERE id=$1 FOR UPDATE", command.id)
            if not row:
                raise HTTPException(status_code=404, detail="Content not found.")
            current_status = row["moderation_status"] or "pending"
            if current_status != command.expected_status:
                raise HTTPException(status_code=409, detail="Content changed since it was loaded. Refresh the queue.")
            if command.decision == "approved":
                if command.table == "post_comments" and (
                    not parent or parent["id"] != row["post_id"]
                    or parent["moderation_status"] != "approved" or parent["is_locked"] is True
                ):
                    raise HTTPException(status_code=409, detail="Comments require an approved, public parent post.")
                if command.table == "reviews" and (
                    not parent or parent["id"] != row["booking_id"]
                    or parent["status"] not in {"completed", "reviewed", "paid_out"} or parent["payment_status"] != "paid"
                    or parent["client_id"] != row["client_id"]
                    or (row["reviewer_id"] or row["client_id"]) != parent["client_id"]
                    or (row["reviewee_id"] or row["photographer_id"]) not in {parent["photographer_id"], parent["model_id"]}
                    or not (row["reviewee_id"] or row["photographer_id"])
                ):
                    raise HTTPException(status_code=409, detail="Reviews require their own completed, paid parent booking.")
                if command.table == "stories":
                    active = await conn.fetchval("SELECT expires_at>now() FROM stories WHERE id=$1", command.id)
                    if active is not True:
                        raise HTTPException(status_code=409, detail="Expired stories cannot be approved.")
            changed = await conn.execute(
                f"UPDATE {command.table} SET moderation_status=$2,updated_at=now() WHERE id=$1", command.id, command.decision,
            )
            if changed != "UPDATE 1":
                raise HTTPException(status_code=409, detail="Content changed. Refresh the queue.")
            # Review status is also used by the reviews UI; keep it consistent with moderation.
            if command.table == "reviews":
                await conn.execute("UPDATE reviews SET status=$2 WHERE id=$1", command.id, command.decision)
            event_id = await audit_decision(conn, user["id"], command.table, row, command.decision, command.reason)
            rejected_comments = 0
            if command.table == "posts" and command.decision == "rejected":
                comments = await conn.fetch("SELECT * FROM post_comments WHERE post_id=$1 AND moderation_status IS DISTINCT FROM 'rejected' ORDER BY id FOR UPDATE", command.id)
                for comment in comments:
                    await conn.execute("UPDATE post_comments SET moderation_status='rejected',updated_at=now() WHERE id=$1", comment["id"])
                    await audit_decision(conn, user["id"], "post_comments", comment, "rejected", command.reason, event_id)
                rejected_comments = len(comments)
            return {"id": command.id, "table": command.table, "moderation_status": command.decision, "audit_event_id": event_id, "rejected_comments": rejected_comments}
    finally:
        await conn.close()


async def handle_content_review(settings: Settings, user, payload: dict):
    """Callable delegate for the parent's existing /moderation/review route."""
    authorize_admin(settings, user)
    try:
        command = ContentDecision.model_validate(payload)
    except ValidationError:
        raise HTTPException(status_code=400, detail="Select supported content, a decision, and a reason of 3 to 1000 characters.")
    return await review_content(settings, user, command)


@router.get("/content")
async def pending(settings: Annotated[Settings, Depends(get_settings)], user: Annotated[dict, Depends(admin_user)]):
    return await list_pending_content(settings, user)


@router.post("/content/review")
async def decide(command: ContentDecision, settings: Annotated[Settings, Depends(get_settings)], user: Annotated[dict, Depends(admin_user)]):
    return await review_content(settings, user, command)


@router.get("/content/{table}/{content_id}/preview")
async def preview(table: str, content_id: str, settings: Annotated[Settings, Depends(get_settings)], user: Annotated[dict, Depends(admin_user)]):
    if table not in {"posts", "stories"}:
        raise HTTPException(status_code=400, detail="This content has no media preview.")
    conn = await connect(settings)
    try:
        columns = CONTENT_COLUMNS[table]
        row = await conn.fetchrow(f"SELECT {columns} FROM {table} WHERE id=$1", content_id)
        if not row:
            raise HTTPException(status_code=404, detail="Content not found.")
        reference = row["media_url"] or (row["image_url"] if table == "posts" else None) or ""
        bucket, separator, path = reference.partition("::")
        if not separator or bucket not in {"post-images", "media", "papzi-media"} or not path.startswith(f"users/{row['author_id']}/"):
            raise HTTPException(status_code=409, detail="A trusted storage preview is not available for this content.")
        return {**signed_url(settings, bucket, path, expires_in=300), "media_type": row["media_type"]}
    finally:
        await conn.close()
