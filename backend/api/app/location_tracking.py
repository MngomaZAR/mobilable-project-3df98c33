import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal, ROUND_CEILING
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .access_control import PUBLIC_ROLES, is_admin
from .config import Settings, get_settings
from .database import connect


router = APIRouter(tags=["location-tracking"])
TRAVEL_LEAD_TIME = timedelta(hours=2)
LOCATION_TTL = timedelta(minutes=5)


def utc_now() -> datetime:
    return datetime.now(UTC)


class LocationInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    # Match the mobile operational bounds, not a claim of precise national boundaries.
    latitude: float = Field(ge=-35, le=-22, allow_inf_nan=False)
    longitude: float = Field(ge=16, le=33, allow_inf_nan=False)
    accuracy_m: float = Field(gt=0, le=100, allow_inf_nan=False)


def actor_id(user: dict[str, Any] | None) -> str:
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication is required.")
    return str(user["id"])


def booked_provider(booking: dict[str, Any]) -> tuple[str, str]:
    if bool(booking.get("photographer_id")) == bool(booking.get("model_id")):
        raise HTTPException(status_code=409, detail="This booking has no valid assigned creator.")
    return (str(booking["model_id"]), "model") if booking.get("model_id") else (str(booking["photographer_id"]), "photographer")


def participant_role(booking: dict[str, Any], actor: str) -> str:
    provider, _ = booked_provider(booking)
    if actor == booking.get("client_id"):
        return "client"
    if actor == provider:
        return "provider"
    raise HTTPException(status_code=403, detail="Only this booking's participants can share a location.")


def tracking_window(booking: dict[str, Any], now: datetime) -> tuple[datetime, datetime]:
    if booking.get("payment_status") != "paid":
        raise HTTPException(status_code=409, detail="Payment must be confirmed before live location sharing.")
    if booking.get("status") not in {"accepted", "in_progress"}:
        raise HTTPException(status_code=409, detail="Live location sharing requires an accepted or in-progress booking.")
    start, end = booking.get("start_datetime"), booking.get("end_datetime")
    if not isinstance(start, datetime) or not isinstance(end, datetime) or not start.tzinfo or not end.tzinfo or not timedelta(0) < end - start <= timedelta(hours=12):
        raise HTTPException(status_code=409, detail="This booking has no valid tracking schedule.")
    opens = start - TRAVEL_LEAD_TIME
    # Stop at the scheduled end even if a creator has not marked the shoot complete.
    if not opens <= now < end:
        raise HTTPException(status_code=409, detail="Live location sharing is available from two hours before the shoot until its scheduled end.")
    return opens, end


async def verified_provider(conn, actor: str, expected_role: str | None = None) -> str:
    profile = await conn.fetchrow("SELECT role,kyc_status,age_verified FROM profiles WHERE id=$1 FOR SHARE", actor)
    if not profile or profile["role"] not in {"model", "photographer"} or (expected_role and profile["role"] != expected_role):
        raise HTTPException(status_code=403, detail="A stored model or photographer profile is required.")
    if profile["kyc_status"] != "approved" or not profile["age_verified"]:
        raise HTTPException(status_code=403, detail="Approved identity and age verification are required to share a creator location.")
    role = profile["role"]
    table = "models" if role == "model" else "photographers"
    if not await conn.fetchrow(f"SELECT id FROM {table} WHERE id=$1 FOR SHARE", actor):
        raise HTTPException(status_code=409, detail="Creator profile not found.")
    return role


def location_result(row: dict[str, Any], window_end: datetime | None = None) -> dict[str, Any]:
    expires = row["created_at"] + LOCATION_TTL
    if window_end:
        expires = min(expires, window_end)
    return {"booking_id": row["booking_id"], "user_id": row["user_id"], "role": row["role"],
            "latitude": row["latitude"], "longitude": row["longitude"], "accuracy_m": float(row["accuracy_m"]),
            "created_at": row["created_at"], "expires_at": expires}


async def insert_location(conn, command: LocationInput, actor: str, role: str, booking_id: str | None, now: datetime) -> dict[str, Any]:
    # Round accuracy conservatively rather than claim better precision than the device reported.
    accuracy = Decimal(str(command.accuracy_m)).quantize(Decimal("0.01"), rounding=ROUND_CEILING)
    row = await conn.fetchrow(
        """INSERT INTO location_tracks (id,booking_id,user_id,role,latitude,longitude,accuracy_m,source,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'app',$8)
        RETURNING booking_id,user_id,role,latitude,longitude,accuracy_m,created_at""",
        str(uuid.uuid4()), booking_id, actor, role, command.latitude, command.longitude, accuracy, now,
    )
    return dict(row)


async def update_booking_location(settings: Settings, booking_id: str, command: LocationInput, user: dict[str, Any]) -> dict[str, Any]:
    actor = actor_id(user)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            booking = await conn.fetchrow("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", booking_id)
            if not booking:
                raise HTTPException(status_code=404, detail="Booking not found.")
            role = participant_role(booking, actor)
            now = utc_now()
            opens, end = tracking_window(booking, now)
            _, provider_type = booked_provider(booking)
            if role == "provider":
                await verified_provider(conn, actor, provider_type)
                await conn.execute("UPDATE bookings SET provider_latitude=$2,provider_longitude=$3,updated_at=$4 WHERE id=$1", booking_id, command.latitude, command.longitude, now)
            else:
                profile = await conn.fetchrow("SELECT role FROM profiles WHERE id=$1 FOR SHARE", actor)
                if not profile or profile["role"] not in PUBLIC_ROLES:
                    raise HTTPException(status_code=403, detail="A stored marketplace profile is required.")
                await conn.execute("UPDATE bookings SET user_latitude=$2,user_longitude=$3,updated_at=$4 WHERE id=$1", booking_id, command.latitude, command.longitude, now)
            row = await insert_location(conn, command, actor, role, booking_id, now)
            return {"location": location_result(row, end), "provider_type": provider_type,
                    "tracking_window_start": opens, "tracking_window_end": end}
    finally:
        await conn.close()


async def get_booking_locations(settings: Settings, booking_id: str, user: dict[str, Any]) -> dict[str, Any]:
    actor = actor_id(user)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            booking = await conn.fetchrow("SELECT * FROM bookings WHERE id=$1 FOR SHARE", booking_id)
            if not booking:
                raise HTTPException(status_code=404, detail="Booking not found.")
            provider, _ = booked_provider(booking)
            if actor not in {booking["client_id"], provider} and not is_admin(settings, user):
                raise HTTPException(status_code=403, detail="Only booking participants or a server administrator can read live locations.")
            now = utc_now()
            opens, end = tracking_window(booking, now)
            # Only fresh, attributable fixes; never fall back to old public service coordinates.
            rows = await conn.fetch(
                """SELECT DISTINCT ON (role) booking_id,user_id,role,latitude,longitude,accuracy_m,created_at
                FROM location_tracks WHERE booking_id=$1
                AND ((role='client' AND user_id=$2) OR (role='provider' AND user_id=$3))
                AND source='app' AND created_at>$4 AND created_at>=$5 AND created_at<=$6
                AND latitude BETWEEN -35 AND -22 AND longitude BETWEEN 16 AND 33
                AND accuracy_m>0 AND accuracy_m<=100
                ORDER BY role,created_at DESC,id DESC""",
                booking_id, booking["client_id"], provider, now - LOCATION_TTL, opens, now,
            )
            return {"booking_id": booking_id, "locations": [location_result(dict(row), end) for row in rows],
                    "tracking_window_start": opens, "tracking_window_end": end}
    finally:
        await conn.close()


async def update_provider_location(settings: Settings, command: LocationInput, user: dict[str, Any]) -> dict[str, Any]:
    actor = actor_id(user)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            role = await verified_provider(conn, actor)
            # A private current fix is not a published service address or a booking travel trail.
            row = await insert_location(conn, command, actor, "provider", None, utc_now())
            return {"location": location_result(row), "provider_type": role}
    finally:
        await conn.close()


@router.post("/bookings/{booking_id}/location")
async def share_booking_location(booking_id: str, command: LocationInput, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    from .builtin_functions import require_user

    user = await require_user(settings, request.headers.get("Authorization", "").removeprefix("Bearer "))
    return await update_booking_location(settings, booking_id, command, user)


@router.get("/bookings/{booking_id}/location")
async def read_booking_locations(booking_id: str, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    from .builtin_functions import require_user

    user = await require_user(settings, request.headers.get("Authorization", "").removeprefix("Bearer "))
    return await get_booking_locations(settings, booking_id, user)


@router.post("/providers/me/location")
async def share_provider_location(command: LocationInput, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    from .builtin_functions import require_user

    user = await require_user(settings, request.headers.get("Authorization", "").removeprefix("Bearer "))
    return await update_provider_location(settings, command, user)
