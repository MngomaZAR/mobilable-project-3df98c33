import hashlib
import json
import uuid
from typing import Any

from fastapi import HTTPException

from .config import Settings
from .database import connect
from .storage import signed_url, validate_path


REACTION_EMOJIS = {"\u2764\ufe0f", "\U0001f602", "\U0001f62e", "\U0001f622", "\U0001f44f", "\U0001f525", "\U0001f4af", "\U0001f60d"}


async def _conversation_members(conn, conversation_id: str, user_id: str) -> set[str]:
    members = await conn.fetch(
        """SELECT p.user_id FROM conversation_participants p
        JOIN conversations c ON c.id=p.conversation_id
        WHERE p.conversation_id=$1 FOR SHARE OF p""", conversation_id,
    )
    member_ids = {row["user_id"] for row in members if row["user_id"]}
    if user_id not in member_ids:
        raise HTTPException(status_code=403, detail="You are not a participant in this conversation.")
    if await conn.fetchval(
        """SELECT EXISTS(SELECT 1 FROM user_blocks
        WHERE (blocker_id=$1 AND blocked_id=ANY($2::text[]))
        OR (blocked_id=$1 AND blocker_id=ANY($2::text[])))""", user_id, sorted(member_ids - {user_id}),
    ):
        raise HTTPException(status_code=403, detail="This conversation is unavailable.")
    return member_ids


def _attachment_ref(value: Any, owner_id: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not value.startswith(f"chat-media::users/{owner_id}/"):
        raise HTTPException(status_code=403, detail="Attach a chat-media storage reference uploaded by your account.")
    bucket, path = value.split("::", 1)
    validate_path(bucket, path)
    if any(character in path for character in "?#") or any(ord(character) < 32 for character in path):
        raise HTTPException(status_code=400, detail="Invalid media location.")
    return value


def _message_result(row) -> dict[str, Any]:
    return {key: value for key, value in dict(row).items() if key != "request_fingerprint"}


async def start_conversation(settings: Settings, user: dict[str, Any], payload: dict[str, Any]):
    participant = str(payload.get("participant_id") or payload.get("participantId") or "")
    if not participant or participant == user["id"]:
        raise HTTPException(status_code=400, detail="Select another participant.")
    direct_key = ":".join(sorted([user["id"], participant]))
    conn = await connect(settings)
    try:
        async with conn.transaction():
            if not await conn.fetchval("SELECT EXISTS(SELECT 1 FROM profiles WHERE id=$1)", participant):
                raise HTTPException(status_code=404, detail="Participant not found.")
            await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"conversation:{direct_key}")
            if await conn.fetchval("SELECT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))", user["id"], participant):
                raise HTTPException(status_code=403, detail="This conversation is unavailable.")
            row = await conn.fetchrow("SELECT id,title FROM conversations WHERE direct_key=$1", direct_key)
            if row:
                members = await _conversation_members(conn, row["id"], user["id"])
                if members != {user["id"], participant}:
                    raise HTTPException(status_code=403, detail="This conversation is unavailable.")
                return dict(row)
            row = await conn.fetchrow("INSERT INTO conversations (id,title,direct_key) VALUES ($1,$2,$3) RETURNING id,title", str(uuid.uuid4()), str(payload.get("title") or "Conversation")[:160], direct_key)
            for person in [user["id"], participant]:
                await conn.execute("INSERT INTO conversation_participants (id,conversation_id,user_id) VALUES ($1,$2,$3)", str(uuid.uuid4()), row["id"], person)
            return dict(row)
    finally:
        await conn.close()


async def chat_messages(settings: Settings, user: dict[str, Any], payload: dict[str, Any]):
    conversation_id = str(payload.get("conversation_id") or payload.get("chat_id") or "")
    action = payload.get("action") or "list"
    conn = await connect(settings)
    try:
        async with conn.transaction():
            if action == "read":
                # Read commands update participant rows also held by the membership check.
                await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", json.dumps(["message-read", conversation_id]))
            member_ids = await _conversation_members(conn, conversation_id, user["id"])
            if action == "list":
                rows = await conn.fetch("SELECT * FROM (SELECT * FROM messages WHERE conversation_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200) recent ORDER BY created_at", conversation_id)
                return {"messages": [_message_result(row) for row in rows]}
            if action == "read":
                await conn.execute(
                    """UPDATE messages SET read_at=now() WHERE conversation_id=$1
                    AND sender_id<>$2 AND deleted_at IS NULL AND read_at IS NULL""", conversation_id, user["id"],
                )
                read_at = await conn.fetchval(
                    """UPDATE conversation_participants SET last_read_at=now()
                    WHERE conversation_id=$1 AND user_id=$2 RETURNING last_read_at""", conversation_id, user["id"],
                )
                return {"success": True, "read_at": read_at}
            if action in ("delete", "react"):
                message_id = payload.get("message_id")
                if not isinstance(message_id, str) or not message_id or len(message_id) > 120 or "\x00" in message_id:
                    raise HTTPException(status_code=400, detail="A message_id is required.")
                operation, emoji = payload.get("operation"), payload.get("emoji")
                if action == "react" and (operation not in ("add", "remove") or not isinstance(emoji, str) or emoji not in REACTION_EMOJIS):
                    raise HTTPException(status_code=400, detail="Select a supported reaction and add or remove it.")
                message = await conn.fetchrow(
                    """SELECT id,sender_id,deleted_at FROM messages
                    WHERE id=$1 AND conversation_id=$2 FOR UPDATE""", message_id, conversation_id,
                )
                if not message:
                    raise HTTPException(status_code=404, detail="Message not found.")
                if action == "delete":
                    if message["sender_id"] != user["id"]:
                        raise HTTPException(status_code=403, detail="Only the sender can delete this message.")
                    if message["deleted_at"] is None:
                        await conn.execute("UPDATE messages SET deleted_at=now() WHERE id=$1", message_id)
                        await conn.execute("DELETE FROM message_reactions WHERE message_id=$1", message_id)
                        await conn.fetchrow("SELECT id FROM conversations WHERE id=$1 FOR UPDATE", conversation_id)
                        latest = await conn.fetchrow(
                            """SELECT body,created_at FROM messages WHERE conversation_id=$1
                            AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1""", conversation_id,
                        )
                        await conn.execute(
                            "UPDATE conversations SET last_message=$2,last_message_at=$3 WHERE id=$1", conversation_id,
                            (latest["body"] or "Attachment") if latest else "", latest["created_at"] if latest else None,
                        )
                    return {"success": True}
                if message["deleted_at"] is not None:
                    raise HTTPException(status_code=404, detail="Message not found.")
                # The message row serializes all reaction writers, including legacy duplicate triplets.
                if operation == "remove":
                    await conn.execute("DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3", message_id, user["id"], emoji)
                elif not await conn.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3)", message_id, user["id"], emoji,
                ):
                    await conn.execute(
                        "INSERT INTO message_reactions (id,message_id,user_id,emoji) VALUES ($1,$2,$3,$4)",
                        str(uuid.uuid4()), message_id, user["id"], emoji,
                    )
                return {"success": True}
            if action == "media-url":
                field = payload.get("field", "media_url")
                if field not in ("media_url", "preview_url"):
                    raise HTTPException(status_code=400, detail="Invalid attachment field.")
                message = await conn.fetchrow(
                    """SELECT sender_id,media_url,preview_url FROM messages
                    WHERE id=$1 AND conversation_id=$2 AND deleted_at IS NULL
                    AND coalesce(locked,false)=false""", str(payload.get("message_id") or ""), conversation_id,
                )
                if not message or not message[field]:
                    raise HTTPException(status_code=404, detail="Attachment not found.")
                reference = _attachment_ref(message[field], message["sender_id"])
                bucket, path = reference.split("::", 1)
                return signed_url(settings, bucket, path)
            if action != "send":
                raise HTTPException(status_code=409, detail="This messaging action is not available in the current release.")
            if payload.get("locked") or payload.get("unlock_price") or payload.get("unlock_booking_id") or payload.get("unlocked") is False:
                raise HTTPException(status_code=409, detail="Digital message purchases are not enabled.")
            client_message_id = payload.get("client_message_id")
            if (
                not isinstance(client_message_id, str) or not 1 <= len(client_message_id) <= 120
                or client_message_id != client_message_id.strip()
                or any(ord(character) < 32 for character in client_message_id)
            ):
                raise HTTPException(status_code=400, detail="A stable client_message_id of 1 to 120 characters is required.")
            text = payload.get("text", payload.get("body", ""))
            if not isinstance(text, str):
                raise HTTPException(status_code=400, detail="Message text must be a string.")
            text = text.strip()
            media = _attachment_ref(payload.get("media_url"), user["id"])
            preview = _attachment_ref(payload.get("preview_url"), user["id"])
            if (not text and not media) or len(text) > 8000:
                raise HTTPException(status_code=400, detail="Enter a message under 8000 characters.")
            message_type = "media" if media else "text"
            if (preview and not media) or payload.get("message_type", message_type) != message_type:
                raise HTTPException(status_code=400, detail="Message type and attachments do not match.")
            request_hash = hashlib.sha256(json.dumps({
                "conversation_id": conversation_id, "text": text, "message_type": message_type,
                "media_url": media, "preview_url": preview,
            }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            # Serialize retries across API workers; the unique index is the database backstop.
            await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", json.dumps(["message", user["id"], client_message_id]))
            existing = await conn.fetchrow(
                "SELECT * FROM messages WHERE sender_id=$1 AND client_message_id=$2", user["id"], client_message_id,
            )
            if existing:
                if existing["request_fingerprint"] != request_hash:
                    raise HTTPException(status_code=409, detail="This client message ID was already used for a different payload.")
                return {"message": _message_result(existing)}
            message = await conn.fetchrow(
                """INSERT INTO messages (id,conversation_id,chat_id,sender_id,body,text,message_type,media_url,preview_url,locked,unlocked,client_message_id,request_fingerprint)
                VALUES ($1,$2,$2,$3,$4,$4,$5,$6,$7,false,true,$8,$9) RETURNING *""",
                str(uuid.uuid4()), conversation_id, user["id"], text, message_type, media, preview, client_message_id, request_hash,
            )
            await conn.execute("UPDATE conversations SET last_message=$2,last_message_at=now() WHERE id=$1", conversation_id, text or "Attachment")
            for recipient in member_ids - {user["id"]}:
                await conn.execute(
                    """INSERT INTO job_outbox (id,kind,payload,dedupe_key,status,attempts,max_attempts,available_at)
                    VALUES ($1,'notification',$2::jsonb,$3,'pending',0,8,now()) ON CONFLICT (dedupe_key) DO NOTHING""",
                    str(uuid.uuid4()), json.dumps({"user_id": recipient, "event_type": "message_received", "conversation_id": conversation_id, "title": "New message", "body": "You have a new message on PAPZII."}), f"message:{message['id']}:{recipient}",
                )
            return {"message": _message_result(message)}
    finally:
        await conn.close()
