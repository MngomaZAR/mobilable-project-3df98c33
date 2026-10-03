import json
import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from .builtin_functions import require_user
from .config import Settings, get_settings
from .database import connect
from .storage import storage_client, validate_path

router = APIRouter(tags=["onboarding"])


class AgeConfirmation(BaseModel):
    date_of_birth: date
    accepted_terms: Literal[True]


@router.post("/auth/age-confirm")
async def confirm_age(command: AgeConfirmation, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, request.headers.get("Authorization", "").removeprefix("Bearer "))
    today, dob = date.today(), command.date_of_birth
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    if not 18 <= age <= 120:
        raise HTTPException(status_code=400, detail="You must be 18 or older and provide a valid date of birth.")
    conn = await connect(settings)
    try:
        async with conn.transaction():
            # Age declaration is distinct from administrator identity verification.
            profile = await conn.fetchrow("UPDATE profiles SET date_of_birth=$2,age_verified=true,age_verified_at=now(),updated_at=now() WHERE id=$1 RETURNING *", user["id"], dob.isoformat())
            if not profile:
                raise HTTPException(status_code=409, detail="Your profile is missing. Contact support.")
            await conn.execute("UPDATE api_users SET metadata=metadata||$2::jsonb WHERE id=$1", user["id"], json.dumps({"age_verified": True}))
            await conn.execute(
                """INSERT INTO user_consents (id,user_id,consent_type,accepted,accepted_at,enabled,version)
                VALUES ($1,$2,'terms',true,now(),true,'1.0') ON CONFLICT(id)
                DO UPDATE SET accepted=true,accepted_at=now(),enabled=true,version='1.0'""", f"{user['id']}:terms", user["id"],
            )
            await conn.execute("INSERT INTO consent_events (id,user_id,consent_type,enabled,consent_version,legal_basis,context) VALUES ($1,$2,'terms',true,'1.0','consent',$3::jsonb)", str(uuid.uuid4()), user["id"], json.dumps({"age_declaration": "18+"}))
            return {"profile": dict(profile)}
    finally:
        await conn.close()


class KycDocument(BaseModel):
    doc_type: Literal["id_book", "passport", "drivers_license", "selfie", "proof_of_address"]
    storage_path: str


@router.post("/kyc/documents")
async def save_document(command: KycDocument, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, request.headers.get("Authorization", "").removeprefix("Bearer "))
    bucket, separator, path = command.storage_path.partition("::")
    validate_path(bucket, path)
    if not separator or bucket != "kyc-documents" or not path.startswith(f"users/{user['id']}/"):
        raise HTTPException(status_code=403, detail="Upload your own identity document first.")
    client = await run_in_threadpool(storage_client, settings)
    try:
        await run_in_threadpool(client.head_object, Bucket=bucket, Key=path)
    except Exception as error:
        raise HTTPException(status_code=409, detail="The uploaded identity document is unavailable.") from error
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await conn.fetchrow("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", user["id"])
            row = await conn.fetchrow(
                """INSERT INTO kyc_documents (id,user_id,doc_type,storage_path,status)
                VALUES ($1,$2,$3,$4,'pending') ON CONFLICT(user_id,doc_type)
                DO UPDATE SET storage_path=excluded.storage_path,status='pending',updated_at=now() RETURNING *""",
                str(uuid.uuid4()), user["id"], command.doc_type, command.storage_path,
            )
            await conn.execute("UPDATE profiles SET verified=false,kyc_status='pending',updated_at=now() WHERE id=$1", user["id"])
            await conn.execute("UPDATE api_users SET metadata=metadata||$2::jsonb WHERE id=$1", user["id"], json.dumps({"kyc_status": "pending"}))
            return {"document": dict(row)}
    finally:
        await conn.close()


@router.post("/kyc/submit")
async def submit_kyc(request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    user = await require_user(settings, request.headers.get("Authorization", "").removeprefix("Bearer "))
    conn = await connect(settings)
    try:
        async with conn.transaction():
            profile = await conn.fetchrow("SELECT * FROM profiles WHERE id=$1 FOR UPDATE", user["id"])
            if not profile or not profile["age_verified"]:
                raise HTTPException(status_code=409, detail="Complete your age declaration first.")
            types = {row["doc_type"] for row in await conn.fetch("SELECT doc_type FROM kyc_documents WHERE user_id=$1", user["id"])}
            if "selfie" not in types or not types & {"id_book", "passport", "drivers_license"}:
                raise HTTPException(status_code=409, detail="Upload identity and selfie documents before submission.")
            await conn.execute("UPDATE profiles SET kyc_status='submitted',verified=false,updated_at=now() WHERE id=$1", user["id"])
            await conn.execute("UPDATE kyc_documents SET status='submitted',updated_at=now() WHERE user_id=$1", user["id"])
            await conn.execute("UPDATE api_users SET metadata=metadata||$2::jsonb WHERE id=$1", user["id"], json.dumps({"kyc_status": "submitted"}))
            return {"submitted": True}
    finally:
        await conn.close()


async def decide_document(settings: Settings, document_id: str, decision: str):
    if decision not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="Invalid document review decision.")
    conn = await connect(settings)
    try:
        async with conn.transaction():
            document = await conn.fetchrow("SELECT user_id FROM kyc_documents WHERE id=$1", document_id)
            if not document:
                raise HTTPException(status_code=404, detail="Identity document not found.")
            # Match the profile-first lock order used by uploads and identity approval.
            await conn.fetchrow("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", document["user_id"])
            row = await conn.fetchrow("UPDATE kyc_documents SET status=$2,updated_at=now() WHERE id=$1 RETURNING *", document_id, decision)
            if decision == "rejected":
                await conn.execute("UPDATE profiles SET verified=false,kyc_status='rejected',updated_at=now() WHERE id=$1", document["user_id"])
                await conn.execute("UPDATE api_users SET metadata=metadata||$2::jsonb WHERE id=$1", document["user_id"], json.dumps({"kyc_status": "rejected"}))
            return {"document": dict(row)}
    finally:
        await conn.close()


async def decide_identity(settings: Settings, user_id: str, decision: str):
    if decision not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="Invalid identity review decision.")
    conn = await connect(settings)
    try:
        async with conn.transaction():
            profile = await conn.fetchrow("SELECT * FROM profiles WHERE id=$1 FOR UPDATE", user_id)
            if not profile:
                raise HTTPException(status_code=404, detail="User not found.")
            if decision == "approved":
                approved = {row["doc_type"] for row in await conn.fetch("SELECT doc_type FROM kyc_documents WHERE user_id=$1 AND status='approved' FOR UPDATE", user_id)}
                if not profile["age_verified"] or "selfie" not in approved or not approved & {"id_book", "passport", "drivers_license"}:
                    raise HTTPException(status_code=409, detail="Review and approve identity and selfie documents first.")
            row = await conn.fetchrow("UPDATE profiles SET kyc_status=$2,verified=$3,updated_at=now() WHERE id=$1 RETURNING *", user_id, decision, decision == "approved")
            await conn.execute("UPDATE api_users SET metadata=metadata||$2::jsonb WHERE id=$1", user_id, json.dumps({"kyc_status": decision}))
            return {"profile": dict(row)}
    finally:
        await conn.close()
