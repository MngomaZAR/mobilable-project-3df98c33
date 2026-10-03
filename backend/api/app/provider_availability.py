from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, StrictBool

from .auth import bearer
from .config import Settings, get_settings
from .database import connect


router = APIRouter(tags=["provider-availability"])


class AvailabilityCommand(BaseModel):
    # Identity, role and KYC are always read from the authenticated owner's stored profile.
    model_config = ConfigDict(extra="ignore")
    is_online: StrictBool


def authenticated_owner(user: dict[str, Any] | None) -> str:
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication is required.")
    return str(user["id"])


async def load_provider(conn, owner: str, *, update: bool):
    lock = "FOR UPDATE" if update else "FOR SHARE"
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"provider:{owner}")
    profile = await conn.fetchrow(
        f"SELECT role,kyc_status,availability_status FROM profiles WHERE id=$1 {lock}", owner
    )
    if not profile or profile["role"] not in {"model", "photographer"}:
        raise HTTPException(status_code=403, detail="Only models and photographers can manage availability.")
    table = "models" if profile["role"] == "model" else "photographers"
    provider = await conn.fetchrow(f"SELECT id,is_online FROM {table} WHERE id=$1 {lock}", owner)
    if not provider:
        raise HTTPException(status_code=409, detail="Create your provider profile first.")
    return profile, provider, table


def availability_state(profile, provider) -> dict[str, Any]:
    online = (
        profile["kyc_status"] == "approved"
        and profile["availability_status"] == "online"
        and provider["is_online"] is True
    )
    return {
        "is_online": online,
        "availability_status": "online" if online else "offline",
        "role": profile["role"],
        "kyc_status": profile["kyc_status"],
    }


async def read_availability(settings: Settings, user: dict[str, Any] | None) -> dict[str, Any]:
    owner = authenticated_owner(user)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            profile, provider, _ = await load_provider(conn, owner, update=False)
            return availability_state(profile, provider)
    finally:
        await conn.close()


async def set_availability(
    settings: Settings, command: AvailabilityCommand, user: dict[str, Any] | None
) -> dict[str, Any]:
    owner = authenticated_owner(user)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            profile, _, table = await load_provider(conn, owner, update=True)
            if command.is_online and profile["kyc_status"] != "approved":
                raise HTTPException(status_code=403, detail="Approved KYC is required to go online.")
            status = "online" if command.is_online else "offline"
            updated_profile = await conn.execute(
                "UPDATE profiles SET availability_status=$2,updated_at=now() WHERE id=$1", owner, status
            )
            updated_provider = await conn.execute(
                f"UPDATE {table} SET is_online=$2,updated_at=now() WHERE id=$1", owner, command.is_online
            )
            if updated_profile != "UPDATE 1" or updated_provider != "UPDATE 1":
                raise HTTPException(status_code=409, detail="Availability could not be saved. Please retry.")
            return {
                "is_online": command.is_online,
                "availability_status": status,
                "role": profile["role"],
                "kyc_status": profile["kyc_status"],
            }
    finally:
        await conn.close()


async def provider_user(
    settings: Annotated[Settings, Depends(get_settings)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
):
    from .builtin_functions import require_user

    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    return await require_user(settings, credentials.credentials)


@router.get("/providers/me/availability")
async def get_provider_availability(
    settings: Annotated[Settings, Depends(get_settings)],
    user: Annotated[dict[str, Any], Depends(provider_user)],
):
    return await read_availability(settings, user)


@router.post("/providers/me/availability")
async def update_provider_availability(
    command: AvailabilityCommand,
    settings: Annotated[Settings, Depends(get_settings)],
    user: Annotated[dict[str, Any], Depends(provider_user)],
):
    return await set_availability(settings, command, user)
