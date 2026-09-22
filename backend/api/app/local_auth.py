import base64
import hashlib
import hmac
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg
from fastapi import HTTPException, status

from .config import Settings
from .database import connect


HASH_ITERATIONS = 260_000
ACCESS_TOKEN_TTL = timedelta(hours=12)
REFRESH_TOKEN_TTL = timedelta(days=30)


def _now() -> datetime:
    return datetime.now(UTC)


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, HASH_ITERATIONS)
    return f"pbkdf2_sha256${HASH_ITERATIONS}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt, digest = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        expected = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _unb64(salt), int(iterations))
        return hmac.compare_digest(expected, _unb64(digest))
    except Exception:
        return False


def normalize_email(email: Any) -> str:
    value = str(email or "").strip().lower()
    if "@" not in value or "." not in value.split("@")[-1]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid email address is required.")
    return value


def normalize_password(password: Any) -> str:
    value = str(password or "")
    if len(value) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters.")
    return value


async def ensure_local_auth_schema(settings: Settings) -> None:
    conn = await connect(settings)
    try:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS api_users (
                id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
                email text NOT NULL UNIQUE,
                password_hash text NOT NULL,
                metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
                email_verified boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS api_sessions (
                access_token text PRIMARY KEY,
                refresh_token text NOT NULL UNIQUE,
                user_id text NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,
                expires_at timestamptz NOT NULL,
                refresh_expires_at timestamptz NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        await conn.execute("CREATE INDEX IF NOT EXISTS api_sessions_user_id_idx ON api_sessions(user_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS api_sessions_expires_at_idx ON api_sessions(expires_at)")
    finally:
        await conn.close()


def user_response(row: asyncpg.Record | dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") if isinstance(row, dict) else row["metadata"]
    if isinstance(metadata, str):
        metadata = json.loads(metadata or "{}")
    metadata = metadata or {}
    return {
        "id": row.get("id") if isinstance(row, dict) else row["id"],
        "email": row.get("email") if isinstance(row, dict) else row["email"],
        "user_metadata": {
            "role": metadata.get("role") or "client",
            "full_name": metadata.get("full_name") or metadata.get("name"),
            "avatar_url": metadata.get("avatar_url"),
            "kyc_status": metadata.get("kyc_status"),
            "age_verified": metadata.get("age_verified"),
        },
    }


def metadata_from_options(options: dict[str, Any]) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    for key in ("metadata", "data", "user_metadata"):
        value = options.get(key)
        if isinstance(value, dict):
            metadata.update(value)
    return metadata


async def create_session(settings: Settings, user: asyncpg.Record | dict[str, Any]) -> dict[str, Any]:
    await ensure_local_auth_schema(settings)
    now = _now()
    access_token = secrets.token_urlsafe(48)
    refresh_token = secrets.token_urlsafe(48)
    expires_at = now + ACCESS_TOKEN_TTL
    refresh_expires_at = now + REFRESH_TOKEN_TTL
    user_id = user.get("id") if isinstance(user, dict) else user["id"]
    conn = await connect(settings)
    try:
        await conn.execute(
            """
            INSERT INTO api_sessions (access_token, refresh_token, user_id, expires_at, refresh_expires_at)
            VALUES ($1, $2, $3, $4, $5)
            """,
            access_token,
            refresh_token,
            user_id,
            expires_at,
            refresh_expires_at,
        )
    finally:
        await conn.close()
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": int(expires_at.timestamp()),
        "user": user_response(user),
    }


async def local_sign_up(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    await ensure_local_auth_schema(settings)
    email = normalize_email(payload.get("email"))
    password = normalize_password(payload.get("password"))
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    metadata = metadata_from_options(options)
    merged_metadata = {
        **metadata,
        "role": metadata.get("role") or "client",
        "full_name": options.get("displayName") or metadata.get("full_name") or metadata.get("name"),
        "avatar_url": metadata.get("avatar_url"),
        "date_of_birth": metadata.get("date_of_birth"),
        "age_verified": bool(metadata.get("date_of_birth") or metadata.get("age_verified")),
    }
    conn = await connect(settings)
    try:
        user = await conn.fetchrow(
            """
            INSERT INTO api_users (id, email, password_hash, metadata)
            VALUES ($1, $2, $3, $4::jsonb)
            RETURNING id, email, metadata, created_at
            """,
            str(uuid.uuid4()),
            email,
            hash_password(password),
            json.dumps(merged_metadata),
        )
    except asyncpg.UniqueViolationError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered.") from error
    finally:
        await conn.close()
    session = await create_session(settings, user)
    return {"session": session, "user": session["user"]}


async def local_sign_in(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    await ensure_local_auth_schema(settings)
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")
    conn = await connect(settings)
    try:
        user = await conn.fetchrow(
            "SELECT id, email, password_hash, metadata, created_at FROM api_users WHERE email = $1",
            email,
        )
    finally:
        await conn.close()
    if not user or not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    session = await create_session(settings, user)
    return {"session": session, "user": session["user"]}


async def user_from_access_token(settings: Settings, token: str) -> dict[str, Any]:
    await ensure_local_auth_schema(settings)
    conn = await connect(settings)
    try:
        row = await conn.fetchrow(
            """
            SELECT u.id, u.email, u.metadata, u.created_at
            FROM api_sessions s
            JOIN api_users u ON u.id = s.user_id
            WHERE s.access_token = $1
              AND s.expires_at > now()
            """,
            token,
        )
    finally:
        await conn.close()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid.")
    return user_response(row)


async def local_refresh(settings: Settings, refresh_token: str | None) -> dict[str, Any]:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token.")
    await ensure_local_auth_schema(settings)
    conn = await connect(settings)
    try:
        row = await conn.fetchrow(
            """
            SELECT u.id, u.email, u.metadata, u.created_at, s.access_token
            FROM api_sessions s
            JOIN api_users u ON u.id = s.user_id
            WHERE s.refresh_token = $1
              AND s.refresh_expires_at > now()
            """,
            refresh_token,
        )
        if row:
            await conn.execute("DELETE FROM api_sessions WHERE access_token = $1", row["access_token"])
    finally:
        await conn.close()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired or invalid.")
    session = await create_session(settings, row)
    return {"session": session, "user": session["user"]}


async def local_sign_out(settings: Settings, token: str | None) -> None:
    if not token:
        return
    await ensure_local_auth_schema(settings)
    conn = await connect(settings)
    try:
        await conn.execute("DELETE FROM api_sessions WHERE access_token = $1", token)
    finally:
        await conn.close()


async def local_update_user(settings: Settings, token: str, attributes: dict[str, Any]) -> dict[str, Any]:
    current = await user_from_access_token(settings, token)
    metadata = dict(current.get("user_metadata") or {})
    user_metadata = attributes.get("data") or attributes.get("metadata") or attributes.get("user_metadata") or {}
    if isinstance(user_metadata, dict):
        metadata.update(user_metadata)
    if attributes.get("email"):
        email = normalize_email(attributes["email"])
    else:
        email = current.get("email")
    conn = await connect(settings)
    try:
        row = await conn.fetchrow(
            """
            UPDATE api_users
            SET email = $2, metadata = $3::jsonb, updated_at = now()
            WHERE id = $1
            RETURNING id, email, metadata, created_at
            """,
            current["id"],
            email,
            json.dumps(metadata),
        )
    finally:
        await conn.close()
    return {"user": user_response(row)}
