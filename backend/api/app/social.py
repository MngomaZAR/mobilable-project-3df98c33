import hashlib
import json
import uuid

from fastapi import HTTPException

from .config import Settings
from .database import connect


async def _lock_visible_post(conn, user_id: str, post_id: str):
    post = await conn.fetchrow("SELECT id,author_id,moderation_status,is_locked FROM posts WHERE id=$1 FOR UPDATE", post_id)
    if not post or (post["author_id"] != user_id and (post["moderation_status"] != "approved" or post["is_locked"])):
        raise HTTPException(status_code=404, detail="Post not found.")
    if await conn.fetchval(
        """SELECT EXISTS(SELECT 1 FROM user_blocks
        WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))""",
        user_id, post["author_id"],
    ):
        raise HTTPException(status_code=404, detail="Post not found.")
    return post


async def create_comment(settings: Settings, user, payload):
    post_id = payload.get("post_id")
    text = payload.get("text", payload.get("body", ""))
    if not isinstance(post_id, str) or not post_id.strip() or "\x00" in post_id:
        raise HTTPException(status_code=400, detail="A post_id is required.")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000 or "\x00" in text:
        raise HTTPException(status_code=400, detail="Enter a comment of 1 to 2000 characters.")
    text = text.strip()
    key = payload.get("idempotency_key")
    if key is not None and (
        not isinstance(key, str) or not 1 <= len(key) <= 120 or key != key.strip()
        or any(ord(character) < 32 for character in key)
    ):
        raise HTTPException(status_code=400, detail="Use an idempotency_key of 1 to 120 characters.")
    request_hash = hashlib.sha256(json.dumps({"post_id": post_id, "body": text}, sort_keys=True, separators=(",", ":")).encode()).hexdigest() if key is not None else None
    conn = await connect(settings)
    try:
        async with conn.transaction():
            if key is not None:
                await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", json.dumps(["comment", user["id"], key]))
            post = await _lock_visible_post(conn, user["id"], post_id)
            if key is not None:
                existing = await conn.fetchrow("SELECT * FROM post_comments WHERE user_id=$1 AND idempotency_key=$2", user["id"], key)
                if existing:
                    if existing["request_fingerprint"] != request_hash:
                        raise HTTPException(status_code=409, detail="This comment idempotency key was already used for a different payload.")
                    return {"comment": {name: value for name, value in dict(existing).items() if name != "request_fingerprint"}}
            comment = await conn.fetchrow(
                """INSERT INTO post_comments (id,post_id,user_id,author_id,body,moderation_status,idempotency_key,request_fingerprint)
                VALUES ($1,$2,$3,$3,$4,'pending',$5,$6) RETURNING *""",
                str(uuid.uuid4()), post["id"], user["id"], text, key, request_hash,
            )
            await conn.execute("UPDATE posts SET comment_count=(SELECT count(*) FROM post_comments WHERE post_id=$1) WHERE id=$1", post["id"])
            return {"comment": {name: value for name, value in dict(comment).items() if name != "request_fingerprint"}}
    finally:
        await conn.close()


async def toggle_post_like(settings: Settings, user, payload):
    if payload.get("p_user_id") not in {None, user["id"]}:
        raise HTTPException(status_code=403, detail="Likes must belong to your account.")
    conn = await connect(settings)
    try:
        async with conn.transaction():
            post_id = str(payload.get("p_post_id") or "")
            await _lock_visible_post(conn, user["id"], post_id)
            deleted = await conn.fetchrow("DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2 RETURNING id", post_id, user["id"])
            liked = deleted is None
            if liked:
                await conn.execute("INSERT INTO post_likes(id,post_id,user_id) VALUES ($1,$2,$3)", str(uuid.uuid4()), post_id, user["id"])
            await conn.execute("UPDATE posts SET likes_count=(SELECT count(*) FROM post_likes WHERE post_id=$1) WHERE id=$1", post_id)
            return {"data": liked, "error": None}
    finally:
        await conn.close()
