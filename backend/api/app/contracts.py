"""Participant-authenticated acknowledgements, not legally approved signatures.

Legacy generic-table signature flags are not adopted as authenticated evidence.
"""

import hashlib
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .auth import bearer
from .booking_engine import enqueue
from .config import Settings, get_settings
from .database import connect
from .dispatch_engine import require_open_account
from .location_tracking import actor_id


router = APIRouter(tags=["contracts"])
SIGNATURE_METHOD = "authenticated_typed_acknowledgement"


def utc_now() -> datetime:
    return datetime.now(UTC)


class ContractCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_type: Literal["model_release", "shoot_agreement"]
    content: str = Field(min_length=1, max_length=50000)

    @field_validator("content")
    @classmethod
    def meaningful_content(cls, value: str) -> str:
        if not value.strip() or "\x00" in value:
            raise ValueError("Contract content must be nonblank text.")
        return value


class ContractSign(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signature: str = Field(min_length=2, max_length=200)
    role: Literal["creator", "client", "model"]
    content_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    content_version: int | None = Field(default=None, ge=1, strict=True)

    @field_validator("signature")
    @classmethod
    def typed_acknowledgement(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2 or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("Provide a nonblank, single-line typed acknowledgement.")
        return value


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def parties(booking) -> dict[str, str]:
    client, photographer, model = booking.get("client_id"), booking.get("photographer_id"), booking.get("model_id")
    creator = photographer or model
    if not client or not creator or client in {photographer, model}:
        raise HTTPException(status_code=409, detail="This booking does not have distinct valid contract parties.")
    result = {"client": client, "creator": creator}
    if model:
        result["model"] = model
    return result


def authorize(booking, actor: str) -> dict[str, str]:
    result = parties(booking)
    if actor not in set(result.values()):
        raise HTTPException(status_code=403, detail="Only this booking's participants can access its contracts.")
    return result


def signable_booking(booking, now: datetime) -> None:
    end = booking.get("end_datetime")
    if booking.get("status") not in {"accepted", "in_progress"} or not isinstance(end, datetime) or not end.tzinfo or now >= end:
        raise HTTPException(status_code=409, detail="Contracts require an accepted or in-progress booking before its scheduled end.")


def contract_result(row) -> dict[str, Any]:
    return {**dict(row), "signature_method": SIGNATURE_METHOD, "legal_approval_status": "not_reviewed"}


async def expire_contract(conn, row, booking, now: datetime):
    if row["status"] == "draft" and (booking.get("status") not in {"accepted", "in_progress"} or row["expires_at"] <= now):
        return await conn.fetchrow("UPDATE contracts SET status='expired',updated_at=$2 WHERE id=$1 RETURNING *", row["id"], now)
    return row


async def load_booking(conn, booking_id: str, actor: str):
    # All contract operations use booking -> contract order to serialize lifecycle changes.
    booking = await conn.fetchrow("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    authorize(booking, actor)
    return dict(booking)


async def list_booking_contracts(settings: Settings, booking_id: str, user: dict[str, Any]) -> list[dict[str, Any]]:
    actor = actor_id(user)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            booking = await load_booking(conn, booking_id, actor)
            rows = await conn.fetch("SELECT * FROM contracts WHERE booking_id=$1 AND content_version IS NOT NULL ORDER BY created_at,id FOR UPDATE", booking_id)
            now = utc_now()
            return [contract_result(await expire_contract(conn, row, booking, now)) for row in rows]
    finally:
        await conn.close()


async def create_contract(settings: Settings, booking_id: str, command: ContractCreate, user: dict[str, Any]) -> dict[str, Any]:
    actor = actor_id(user)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            booking = await load_booking(conn, booking_id, actor)
            party_map = parties(booking)
            for participant in sorted(set(party_map.values())):
                await require_open_account(conn, participant)
            existing = await conn.fetchrow(
                "SELECT * FROM contracts WHERE booking_id=$1 AND contract_type=$2 AND content_version IS NOT NULL FOR UPDATE",
                booking_id, command.contract_type,
            )
            digest = content_hash(command.content)
            if existing:
                if existing["content_hash"] != digest or existing["content"] != command.content:
                    raise HTTPException(status_code=409, detail="An immutable contract already exists for this booking and type.")
                return contract_result(await expire_contract(conn, existing, booking, utc_now()))
            now = utc_now()
            signable_booking(booking, now)
            title = "Model Release" if command.contract_type == "model_release" else "Shoot Agreement"
            row = await conn.fetchrow(
                """INSERT INTO contracts (id,booking_id,creator_id,photographer_id,client_id,model_id,contract_type,
                content,body,title,status,content_hash,content_version,created_by,expires_at,
                signed_by_client,signed_by_photographer,signed_by_model)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,'draft',$10,1,$11,$12,false,false,false) RETURNING *""",
                str(uuid.uuid4()), booking_id, party_map["creator"], booking.get("photographer_id"), party_map["client"],
                booking.get("model_id"), command.contract_type, command.content, title, digest, actor, booking["end_datetime"],
            )
            for recipient in sorted(set(party_map.values()) - {actor}):
                await enqueue(conn, "notification", {"user_id": recipient, "event_type": "booking_contract_created", "booking_id": booking_id,
                              "contract_id": row["id"], "content_hash": digest, "title": "Booking document ready",
                              "body": "A booking participant shared a document for review."}, f"contract:{row['id']}:created:{recipient}")
            return contract_result(row)
    finally:
        await conn.close()


async def sign_contract(settings: Settings, contract_id: str, command: ContractSign, user: dict[str, Any]) -> dict[str, Any]:
    actor = actor_id(user)
    conn = await connect(settings)
    error = None
    result = None
    try:
        async with conn.transaction():
            hint = await conn.fetchrow("SELECT booking_id FROM contracts WHERE id=$1 AND content_version IS NOT NULL", contract_id)
            if not hint:
                raise HTTPException(status_code=404, detail="Authenticated booking contract not found.")
            booking = await load_booking(conn, hint["booking_id"], actor)
            party_map = parties(booking)
            for participant in sorted(set(party_map.values())):
                await require_open_account(conn, participant)
            row = await conn.fetchrow("SELECT * FROM contracts WHERE id=$1 FOR UPDATE", contract_id)
            if (row["client_id"], row["creator_id"], row["photographer_id"], row["model_id"]) != (party_map["client"], party_map["creator"], booking.get("photographer_id"), booking.get("model_id")):
                raise HTTPException(status_code=409, detail="The booking parties no longer match this immutable contract.")
            if party_map.get(command.role) != actor:
                raise HTTPException(status_code=403, detail="Sign only as your authenticated booking party.")
            if row["content_hash"] != content_hash(row["content"]):
                raise HTTPException(status_code=409, detail="The contract content hash is invalid.")
            if (command.content_hash is not None and command.content_hash != row["content_hash"]) or (command.content_version is not None and command.content_version != row["content_version"]):
                raise HTTPException(status_code=409, detail="Review the current immutable document before acknowledging it.")
            existing = await conn.fetchrow("SELECT * FROM contract_signatures WHERE contract_id=$1 AND signer_id=$2", contract_id, actor)
            if existing:
                if existing["signature"] != command.signature:
                    raise HTTPException(status_code=409, detail="Your acknowledgement is immutable and cannot be overwritten.")
                return contract_result(row)
            now = utc_now()
            row = await expire_contract(conn, row, booking, now)
            if row["status"] != "draft":
                error = HTTPException(status_code=409, detail="This contract is no longer open for acknowledgement.")
            else:
                signable_booking(booking, now)
                await conn.execute(
                    """INSERT INTO contract_signatures (contract_id,signer_id,signature,content_hash,content_version,method,signed_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)""", contract_id, actor, command.signature, row["content_hash"], row["content_version"], SIGNATURE_METHOD, now,
                )
                signatures = await conn.fetch("SELECT signer_id,signature,signed_at FROM contract_signatures WHERE contract_id=$1", contract_id)
                by_party = {signature["signer_id"]: signature for signature in signatures}
                complete = set(party_map.values()) <= set(by_party)
                values = {role: by_party.get(party) for role, party in party_map.items()}
                client, creator, model = (values.get(role) for role in ("client", "creator", "model"))
                row = await conn.fetchrow(
                    """UPDATE contracts SET client_signature=$2,creator_signature=$3,model_signature=$4,
                    client_signed_at=$5,photographer_signed_at=$6,model_signed_at=$7,
                    signed_by_client=$8,signed_by_photographer=$9,signed_by_model=$10,
                    status=$11,signed_at=$12,updated_at=$13 WHERE id=$1 RETURNING *""",
                    contract_id, client["signature"] if client else None, creator["signature"] if creator else None,
                    model["signature"] if model else None, client["signed_at"] if client else None,
                    creator["signed_at"] if creator and booking.get("photographer_id") else None,
                    model["signed_at"] if model else None, bool(client), bool(creator and booking.get("photographer_id")), bool(model),
                    "signed" if complete else "draft", now if complete else None, now,
                )
                for recipient in sorted(set(party_map.values()) - {actor}):
                    await enqueue(conn, "notification", {"user_id": recipient, "event_type": "booking_contract_acknowledged", "booking_id": booking["id"],
                                  "contract_id": contract_id, "content_hash": row["content_hash"], "title": "Booking document updated",
                                  "body": "A booking participant acknowledged the document."}, f"contract:{contract_id}:signed:{actor}:{recipient}")
                result = contract_result(row)
        if error:
            raise error
        return result
    finally:
        await conn.close()


async def contract_user(settings: Annotated[Settings, Depends(get_settings)], credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    from .builtin_functions import require_user

    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    return await require_user(settings, credentials.credentials)


@router.get("/bookings/{booking_id}/contracts")
async def contract_list_route(booking_id: str, settings: Annotated[Settings, Depends(get_settings)], user: Annotated[dict[str, Any], Depends(contract_user)]):
    return await list_booking_contracts(settings, booking_id, user)


@router.post("/bookings/{booking_id}/contracts")
async def contract_create_route(booking_id: str, command: ContractCreate, settings: Annotated[Settings, Depends(get_settings)], user: Annotated[dict[str, Any], Depends(contract_user)]):
    return await create_contract(settings, booking_id, command, user)


@router.post("/contracts/{contract_id}/sign")
async def contract_sign_route(contract_id: str, command: ContractSign, settings: Annotated[Settings, Depends(get_settings)], user: Annotated[dict[str, Any], Depends(contract_user)]):
    return await sign_contract(settings, contract_id, command, user)
