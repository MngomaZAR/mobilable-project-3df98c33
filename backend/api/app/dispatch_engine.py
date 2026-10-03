"""Booking-backed dispatch. Matching distance is never a navigation estimate.

Integrate before checkout: prepare a server-quoted pending booking, then dispatch it.
The existing scheduled-booking accept command must not accept an offered dispatch.
"""

import hashlib
import json
import math
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from .auth import bearer
from .booking_engine import BookingEquipment, BookingInput, calculate_quote, check_availability, distance_km, enqueue, money
from .config import Settings, get_settings
from .database import connect
from .location_tracking import LOCATION_TTL, actor_id
from .provider_settings import PACKAGES, load_pricing


router = APIRouter(tags=["dispatch"])
INSTANT_LEAD_TIME = timedelta(hours=2)


def utc_now() -> datetime:
    return datetime.now(UTC)


async def require_open_account(conn, user_id: str) -> None:
    """Share-lock the authoritative account so closure cannot race a new commitment."""
    if not user_id:
        raise HTTPException(status_code=403, detail="An active stored account is required.")
    account = await conn.fetchrow("SELECT id,metadata FROM api_users WHERE id=$1 FOR SHARE", user_id)
    if not account or not account.get("id") or str(account["id"]) != str(user_id):
        raise HTTPException(status_code=403, detail="An active stored account is required.")
    metadata = json_object(account["metadata"])
    if metadata.get("deletion_status") in {"pending", "processing", "completed"}:
        raise HTTPException(status_code=403, detail="Closing accounts cannot create new bookings, offers or acknowledgements.")


class DispatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # No anonymous, duration-free request: a server-priced booking is required.
    booking_id: str = Field(min_length=1, max_length=120)
    service_type: Literal["photography", "modeling"] | None = None
    fanout_count: int = Field(ge=1, le=20, strict=True)
    intensity_level: int = Field(ge=1, le=5, strict=True)
    sla_timeout_seconds: int = Field(default=90, ge=15, le=300, strict=True)
    requested_lat: float | None = Field(default=None, ge=-35, le=-22, allow_inf_nan=False)
    requested_lng: float | None = Field(default=None, ge=16, le=33, allow_inf_nan=False)
    # Compatibility only: not used as a price, ceiling, surge or fee.
    base_amount: Decimal | None = Field(default=None, ge=0, le=10000000, allow_inf_nan=False)
    required_tier: str | None = None
    required_equipment: BookingEquipment | None = None
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=120)

    @model_validator(mode="after")
    def validate_selection(self):
        if (self.requested_lat is None) != (self.requested_lng is None):
            raise ValueError("Provide both requested coordinates or neither.")
        if self.required_tier is not None and self.required_tier not in PACKAGES:
            raise ValueError("Select a defined photographer package.")
        return self


class DispatchRespond(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dispatch_request_id: str = Field(min_length=1, max_length=120)
    offer_id: str | None = Field(default=None, min_length=1, max_length=120)
    response: Literal["accept", "decline"]
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=120)


class DispatchState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dispatch_request_id: str = Field(min_length=1, max_length=120)


def json_object(value: Any) -> dict[str, Any]:
    result = json.loads(value) if isinstance(value, str) else value
    if not isinstance(result, dict):
        raise HTTPException(status_code=409, detail="A valid server pricing snapshot is required.")
    return result


def in_service_region(lat: Any, lng: Any) -> bool:
    try:
        # Operational ZA bounds, matching location_tracking; not a border attestation.
        return math.isfinite(float(lat)) and math.isfinite(float(lng)) and -35 <= float(lat) <= -22 and 16 <= float(lng) <= 33
    except (ValueError, TypeError, OverflowError):
        return False


def booking_command(booking: dict[str, Any], provider_id: str | None = None) -> BookingInput:
    role = "photographer" if booking.get("photographer_id") else "model"
    if bool(booking.get("photographer_id")) == bool(booking.get("model_id")):
        raise HTTPException(status_code=409, detail="The booking must identify exactly one creator role.")
    values = {key: booking[key] for key in BookingInput.model_fields if booking.get(key) is not None}
    values["equipment_selection"] = json_object(values.get("equipment_selection", {}))
    values["idempotency_key"] = booking.get("idempotency_key") or f"dispatch:{booking['id']}"
    values["is_instant"] = False
    values.pop("expected_total_amount", None)
    if provider_id:
        values[f"{role}_id"] = provider_id
    try:
        return BookingInput.model_validate(values)
    except ValidationError as error:
        raise HTTPException(status_code=409, detail="The booking has no valid service and schedule snapshot.") from error


def pricing_ceiling(booking: dict[str, Any], command: BookingInput) -> Decimal:
    snapshot = json_object(booking.get("pricing_snapshot"))
    try:
        total = Decimal(str(snapshot["total_amount"]))
        commission = Decimal(str(snapshot["commission_amount"]))
        payout = Decimal(str(snapshot["payout_amount"]))
        rate = Decimal(str(snapshot["commission_rate"]))
        if not all(value.is_finite() for value in (total, commission, payout, rate)):
            raise ValueError()
        if not total > 0 or commission < 0 or payout < 0 or not 0 <= rate <= 1:
            raise ValueError()
        if money(total) != total or commission + payout != total or money(total * rate) != commission:
            raise ValueError()
        if snapshot.get("currency") != "ZAR" or snapshot.get("version") != 1:
            raise ValueError()
        if any(money(booking[key]) != total for key in ("quote_amount", "total_amount", "price_total")):
            raise ValueError()
        if snapshot.get("provider_id") != (command.photographer_id or command.model_id):
            raise ValueError()
        for key in ("package_id", "model_service_type", "photography_service_type", "equipment_selection"):
            expected = command.model_dump()[key]
            if key == "photography_service_type" and command.model_id:
                expected = None
            if snapshot.get(key) != expected:
                raise ValueError()
    except (KeyError, TypeError, ValueError, ArithmeticError) as error:
        raise HTTPException(status_code=409, detail="Refresh this booking's authoritative quote before dispatch.") from error
    return total


def request_fingerprint(command: DispatchCreate) -> str:
    body = command.model_dump(mode="json", exclude={"base_amount", "idempotency_key"})
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_intake(booking: dict[str, Any], command: DispatchCreate, now: datetime) -> tuple[BookingInput, Decimal]:
    if booking.get("status") != "pending" or booking.get("payment_status") != "unpaid":
        raise HTTPException(status_code=409, detail="Dispatch requires a pending unpaid booking, before checkout.")
    original = booking_command(booking)
    if not now < original.start_datetime <= now + INSTANT_LEAD_TIME:
        raise HTTPException(status_code=409, detail="Instant dispatch requires a future start within two hours.")
    if not booking.get("hold_expires_at") or booking["hold_expires_at"] <= now:
        raise HTTPException(status_code=409, detail="This booking hold has expired.")
    if not in_service_region(original.user_latitude, original.user_longitude):
        raise HTTPException(status_code=422, detail="Choose a location inside the ZA operational service region.")
    service = "photography" if original.photographer_id else "modeling"
    if command.service_type is not None and command.service_type != service:
        raise HTTPException(status_code=409, detail="Dispatch must match the booked creator role.")
    if command.requested_lat is not None and (command.requested_lat, command.requested_lng) != (original.user_latitude, original.user_longitude):
        raise HTTPException(status_code=409, detail="Dispatch coordinates must match the quoted booking location.")
    if command.required_tier is not None and command.required_tier != original.package_id:
        raise HTTPException(status_code=409, detail="Dispatch must match the quoted package.")
    if command.required_equipment is not None and command.required_equipment != original.equipment_selection:
        raise HTTPException(status_code=409, detail="Dispatch must match the quoted equipment selection.")
    return original, pricing_ceiling(booking, original)


async def event(conn, request_id: str, booking_id: str, actor: str, kind: str, payload: dict[str, Any]) -> None:
    await conn.execute(
        "INSERT INTO dispatch_events (id,dispatch_request_id,booking_id,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
        str(uuid.uuid4()), request_id, booking_id, actor, kind, json.dumps(payload),
    )


async def notify(conn, request, recipient: str, kind: str, offer_id: str | None = None) -> None:
    body = {"offered": "Review the service and quoted price.", "declined": "A creator declined their offer.",
            "accepted": "A creator accepted the request.", "expired": "The request expired without an assignment.",
            "cancelled": "The request was cancelled."}[kind]
    payload = {"user_id": recipient, "event_type": f"booking_dispatch_{kind}", "booking_id": request["booking_id"],
               "dispatch_request_id": request["id"], "offer_id": offer_id,
               "title": "Instant booking offer" if kind == "offered" else "Instant booking updated",
               "body": body,
               "expires_at": request["expires_at"].isoformat()}
    await enqueue(conn, "notification", payload, f"dispatch:{request['id']}:{recipient}:{kind}:{offer_id or 'state'}")


async def fresh_provider(conn, provider_id: str, role: str, now: datetime) -> dict[str, Any]:
    await require_open_account(conn, provider_id)
    profile = await conn.fetchrow("SELECT role,kyc_status,age_verified,availability_status FROM profiles WHERE id=$1 FOR SHARE", provider_id)
    if not profile or profile["role"] != role or profile["kyc_status"] != "approved" or profile["age_verified"] is not True or profile["availability_status"] != "online":
        raise HTTPException(status_code=409, detail="This creator is not verified and online for dispatch.")
    table = "photographers" if role == "photographer" else "models"
    row = await conn.fetchrow(f"SELECT * FROM {table} WHERE id=$1 FOR SHARE", provider_id)
    if not row or row["is_online"] is not True:
        raise HTTPException(status_code=409, detail="This creator is offline.")
    fix = await conn.fetchrow(
        """SELECT latitude,longitude,accuracy_m,created_at FROM location_tracks
        WHERE user_id=$1 AND booking_id IS NULL AND role=$2 AND source='app'
        AND created_at>$3 AND created_at<=$4 AND accuracy_m>0 AND accuracy_m<=100
        AND latitude BETWEEN -35 AND -22 AND longitude BETWEEN 16 AND 33
        ORDER BY created_at DESC,id DESC LIMIT 1""", provider_id, role, now - LOCATION_TTL, now,
    )
    if not fix or not in_service_region(fix["latitude"], fix["longitude"]):
        raise HTTPException(status_code=409, detail="A fresh accurate private creator GPS fix is required for dispatch.")
    provider = dict(row)
    try:
        radius = float(provider["travel_radius"])
        if not math.isfinite(radius) or not 0 < radius <= 500:
            raise ValueError()
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        raise HTTPException(status_code=409, detail="A valid published creator travel radius is required.") from error
    provider["latitude"], provider["longitude"] = fix["latitude"], fix["longitude"]
    return provider


async def expire_request(conn, request, booking, now: datetime) -> dict[str, Any]:
    request = dict(request)
    if request["status"] not in {"queued", "offered"}:
        return request
    cancelled = booking["status"] != "pending" or booking["payment_status"] != "unpaid"
    if not cancelled and request["expires_at"] > now:
        return request
    status = "cancelled" if cancelled else "expired"
    request = dict(await conn.fetchrow("UPDATE dispatch_requests SET status=$2,updated_at=$3 WHERE id=$1 RETURNING *", request["id"], status, now))
    await conn.execute("UPDATE dispatch_offers SET status=$2 WHERE dispatch_request_id=$1 AND status='offered'", request["id"], status)
    await conn.execute(
        "UPDATE bookings SET assignment_state=$2,status=CASE WHEN status='pending' AND payment_status='unpaid' THEN 'cancelled' ELSE status END,hold_expires_at=$3,updated_at=$3 WHERE id=$1",
        booking["id"], status, now,
    )
    await event(conn, request["id"], booking["id"], booking["client_id"], status, {})
    await notify(conn, request, booking["client_id"], status)
    return request


def public_offer(row) -> dict[str, Any]:
    result = {key: row[key] for key in ("id", "dispatch_request_id", "provider_id", "offer_rank", "status", "idempotency_key", "responded_at", "created_at", "expires_at")}
    snapshot = json_object(row["pricing_snapshot"])
    result["quote"] = {key: snapshot[key] for key in ("currency", "total_amount", "base_amount", "equipment_amount", "travel_amount", "package_id", "model_service_type", "pricing_basis")}
    for key in ("total_amount", "base_amount", "equipment_amount", "travel_amount"):
        result["quote"][key] = money(result["quote"][key])
    return result


async def state_result(conn, request, actor: str) -> dict[str, Any]:
    owner = actor == request["client_id"]
    offers = await conn.fetch("SELECT * FROM dispatch_offers WHERE dispatch_request_id=$1 AND ($2::text IS NULL OR provider_id=$2) ORDER BY offer_rank", request["id"], None if owner else actor)
    events = await conn.fetch(
        "SELECT id,event_type,created_at,payload FROM dispatch_events WHERE dispatch_request_id=$1 AND ($2::text IS NULL OR actor_id=$2 OR event_type IN ('expired','cancelled')) ORDER BY created_at,id",
        request["id"], None if owner else actor,
    )
    total = request["price_estimate"]
    quote = {"id": request["id"], "quote_token": request["quote_token"], "fanout_count": request["fanout_count"],
             "intensity_level": request["intensity_level"], "base_amount": total, "surge_multiplier": 1,
             "intensity_multiplier": 1, "total_amount": total, "currency": "ZAR", "created_at": request["created_at"],
             "expires_at": request["expires_at"], "status": "preview" if request["status"] in {"queued", "offered"} else request["status"],
             "is_ceiling": request["status"] != "accepted"}
    public_request = {key: request[key] for key in (
        "id", "booking_id", "client_id", "service_type", "fanout_count", "intensity_level", "sla_timeout_seconds",
        "status", "assignment_profile_id", "quote_token", "requested_lat", "requested_lng", "price_base",
        "price_multiplier", "price_estimate", "expires_at", "accepted_at", "created_at", "updated_at",
    )}
    return {"dispatch_request": public_request, "offers": [public_offer(row) for row in offers], "quote": quote,
            "events": [{**dict(row), "payload": json_object(row["payload"])} for row in events],
            "assignment_state": request["status"], "eta_confidence": 0}


async def create_dispatch(settings: Settings, command: DispatchCreate, user: dict[str, Any]) -> dict[str, Any]:
    actor = actor_id(user)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await require_open_account(conn, actor)
            # Booking -> request -> provider locks, consistent with booking transitions.
            booking = await conn.fetchrow("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", command.booking_id)
            if not booking:
                raise HTTPException(status_code=404, detail="Booking not found.")
            if booking["client_id"] != actor:
                raise HTTPException(status_code=403, detail="Only the booking requester can dispatch it.")
            key = command.idempotency_key or f"booking:{command.booking_id}"
            await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"dispatch:{actor}:{key}")
            existing = await conn.fetchrow("SELECT * FROM dispatch_requests WHERE booking_id=$1 OR (client_id=$2 AND idempotency_key=$3) FOR UPDATE", command.booking_id, actor, key)
            fingerprint = request_fingerprint(command)
            if existing:
                if existing["request_fingerprint"] != fingerprint or existing["booking_id"] != command.booking_id:
                    raise HTTPException(status_code=409, detail="This dispatch key or booking already has a different request.")
                existing = await expire_request(conn, existing, booking, utc_now())
                return await state_result(conn, existing, actor)
            now = utc_now()
            original, ceiling = validate_intake(dict(booking), command, now)
            expires = min(now + timedelta(seconds=command.sla_timeout_seconds), original.start_datetime, booking["hold_expires_at"])
            if expires - now < timedelta(seconds=15):
                raise HTTPException(status_code=409, detail="There is insufficient time remaining for a dispatch offer.")
            request_id = str(uuid.uuid4())
            role = "photographer" if original.photographer_id else "model"
            request = await conn.fetchrow(
                """INSERT INTO dispatch_requests (id,booking_id,client_id,service_type,fanout_count,intensity_level,
                sla_timeout_seconds,status,quote_token,requested_lat,requested_lng,price_base,price_multiplier,
                price_estimate,expires_at,idempotency_key,request_fingerprint,booking_snapshot)
                VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$10,$11,1,$11,$12,$13,$14,$15::jsonb) RETURNING *""",
                request_id, booking["id"], actor, "photography" if role == "photographer" else "modeling",
                command.fanout_count, command.intensity_level, command.sla_timeout_seconds, str(uuid.uuid4()),
                original.user_latitude, original.user_longitude, ceiling, expires, key, fingerprint,
                json.dumps(original.model_dump(mode="json")),
            )
            table = "photographers" if role == "photographer" else "models"
            candidates = await conn.fetch(
                f"""SELECT p.id FROM profiles p JOIN {table} c ON c.id=p.id
                WHERE p.role=$1 AND p.kyc_status='approved' AND p.age_verified=true
                AND p.availability_status='online' AND c.is_online=true AND p.id<>$2
                AND EXISTS(SELECT 1 FROM location_tracks l WHERE l.user_id=p.id AND l.booking_id IS NULL
                AND l.role=$1 AND l.source='app' AND l.created_at>$3 AND l.created_at<=$4
                AND l.accuracy_m>0 AND l.accuracy_m<=100) ORDER BY p.id LIMIT 200""", role, actor, now - LOCATION_TTL, now,
            )
            eligible = []
            for candidate in candidates:
                provider_id = candidate["id"]
                # Sorted acquisition avoids deadlocks when requests share candidate sets.
                await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"provider:{provider_id}")
                try:
                    provider = await fresh_provider(conn, provider_id, role, now)
                    quoted_command = booking_command(dict(booking), provider_id)
                    await check_availability(conn, quoted_command, provider_id, booking["id"])
                    provider = await load_pricing(conn, provider, role)
                    quote = calculate_quote(settings, quoted_command, provider)
                    if quote["total_amount"] > ceiling:
                        continue
                    eligible.append((quote["distance_km"], provider_id, quote))
                except HTTPException as error:
                    if error.status_code not in {403, 404, 409}:
                        raise
            eligible.sort(key=lambda item: (item[0], item[1]))
            if utc_now() >= expires:
                eligible = []
            for rank, (_, provider_id, quote) in enumerate(eligible[:command.fanout_count], 1):
                offer_id = str(uuid.uuid4())
                await conn.execute(
                    "INSERT INTO dispatch_offers (id,dispatch_request_id,provider_id,offer_rank,status,expires_at,pricing_snapshot) VALUES ($1,$2,$3,$4,'offered',$5,$6::jsonb)",
                    offer_id, request_id, provider_id, rank, expires, json.dumps({"version": 1, **quote}, default=str),
                )
                await notify(conn, request, provider_id, "offered", offer_id)
            status = "offered" if eligible else "expired"
            request = await conn.fetchrow("UPDATE dispatch_requests SET status=$2,updated_at=$3 WHERE id=$1 RETURNING *", request_id, status, now)
            await conn.execute(
                """UPDATE bookings SET dispatch_request_id=$2,assignment_state=$3,is_instant=true,quote_token=$4,
                fanout_count=$5,intensity_level=$6,hold_expires_at=$7,
                status=CASE WHEN $3='expired' THEN 'cancelled' ELSE status END,updated_at=$8 WHERE id=$1""",
                booking["id"], request_id, status, request["quote_token"], command.fanout_count, command.intensity_level, expires, now,
            )
            await event(conn, request_id, booking["id"], actor, status, {"offer_count": min(len(eligible), command.fanout_count)})
            if not eligible:
                await notify(conn, request, actor, "expired")
            return await state_result(conn, request, actor)
    finally:
        await conn.close()


async def locked_request(conn, request_id: str, actor: str):
    request = await conn.fetchrow("SELECT * FROM dispatch_requests WHERE id=$1", request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Dispatch request not found.")
    offered = await conn.fetchrow("SELECT * FROM dispatch_offers WHERE dispatch_request_id=$1 AND provider_id=$2", request_id, actor)
    if actor != request["client_id"] and not offered:
        raise HTTPException(status_code=403, detail="Only the requester and offered creators can access this dispatch.")
    booking = await conn.fetchrow("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", request["booking_id"])
    if not booking or booking["client_id"] != request["client_id"] or booking.get("dispatch_request_id") != request_id:
        raise HTTPException(status_code=409, detail="This dispatch is not attached to its requester's booking.")
    request = await conn.fetchrow("SELECT * FROM dispatch_requests WHERE id=$1 FOR UPDATE", request_id)
    return dict(request), dict(booking)


async def get_dispatch_state(settings: Settings, request_id: str, user: dict[str, Any]) -> dict[str, Any]:
    actor = actor_id(user)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            request, booking = await locked_request(conn, request_id, actor)
            request = await expire_request(conn, request, booking, utc_now())
            return await state_result(conn, request, actor)
    finally:
        await conn.close()


async def accept_winner(conn, request, booking, offer, actor: str):
    await require_open_account(conn, request["client_id"])
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"provider:{actor}")
    now = utc_now()
    request = await expire_request(conn, request, booking, now)
    if request["status"] != "offered" or offer["expires_at"] <= now:
        return request, now, False
    role = "photographer" if request["service_type"] == "photography" else "model"
    provider = await fresh_provider(conn, actor, role, now)
    original = BookingInput.model_validate(json_object(request["booking_snapshot"]))
    accepted = original.model_copy(update={f"{role}_id": actor})
    if not now < accepted.start_datetime or booking.get("payment_status") != "unpaid" or booking.get("status") != "pending":
        raise HTTPException(status_code=409, detail="The booking can no longer be assigned before payment.")
    if distance_km(accepted.user_latitude, accepted.user_longitude, provider["latitude"], provider["longitude"]) > float(provider["travel_radius"]):
        raise HTTPException(status_code=409, detail="The booking is now outside this creator's travel radius.")
    await check_availability(conn, accepted, actor, booking["id"])
    snapshot = json_object(offer["pricing_snapshot"])
    # Honor the published offer during its short validity, without repricing it.
    total, commission, payout = (money(snapshot[key]) for key in ("total_amount", "commission_amount", "payout_amount"))
    if snapshot["provider_id"] != actor or total > money(request["price_base"]) or total != commission + payout:
        raise HTTPException(status_code=409, detail="The stored dispatch quote is invalid.")
    now = utc_now()
    request = await expire_request(conn, request, booking, now)
    if request["status"] != "offered":
        return request, now, False
    updated = await conn.fetchrow(
        """UPDATE dispatch_requests SET status='accepted',assignment_profile_id=$2,accepted_at=$3,price_estimate=$4,updated_at=$3
        WHERE id=$1 AND status='offered' AND expires_at>clock_timestamp() RETURNING *""", request["id"], actor, now, total,
    )
    if not updated:
        request = await expire_request(conn, request, booking, max(utc_now(), request["expires_at"]))
        return request, now, False
    request = dict(updated)
    await conn.execute(
        """UPDATE bookings SET photographer_id=$2,model_id=$3,status='accepted',assignment_state='accepted',
        accepted_at=$4,hold_expires_at=NULL,price_total=$5,total_amount=$5,quote_amount=$5,
        commission_amount=$6,photographer_payout=$7,payout_amount=$7,distance_km=$8,
        package_type=$9,pricing_snapshot=$10::jsonb,updated_at=$4 WHERE id=$1""",
        booking["id"], actor if role == "photographer" else None, actor if role == "model" else None,
        now, total, commission, payout, money(snapshot["distance_km"]), snapshot["package_name"], json.dumps(snapshot),
    )
    await conn.execute("UPDATE dispatch_offers SET status='cancelled' WHERE dispatch_request_id=$1 AND provider_id<>$2 AND status='offered'", request["id"], actor)
    return request, now, True


async def respond_to_dispatch(settings: Settings, command: DispatchRespond, user: dict[str, Any]) -> dict[str, Any]:
    actor = actor_id(user)
    conn = await connect(settings)
    error = None
    result = None
    try:
        async with conn.transaction():
            request, booking = await locked_request(conn, command.dispatch_request_id, actor)
            offer = await conn.fetchrow("SELECT * FROM dispatch_offers WHERE dispatch_request_id=$1 AND provider_id=$2 FOR UPDATE", request["id"], actor)
            if not offer or (command.offer_id is not None and command.offer_id != offer["id"]):
                raise HTTPException(status_code=403, detail="Respond only to your own offer.")
            if command.idempotency_key:
                await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"dispatch-response:{actor}:{command.idempotency_key}")
                previous = await conn.fetchrow("SELECT id FROM dispatch_offers WHERE provider_id=$1 AND idempotency_key=$2 AND responded_at IS NOT NULL", actor, command.idempotency_key)
                if previous and previous["id"] != offer["id"]:
                    raise HTTPException(status_code=409, detail="This response key belongs to a different offer.")
            target = "accepted" if command.response == "accept" else "declined"
            if offer["responded_at"]:
                if offer["status"] != target or (command.idempotency_key and command.idempotency_key != offer["idempotency_key"]):
                    raise HTTPException(status_code=409, detail="This offer already has a different response.")
                return {"status": target, "offer": public_offer(offer)}
            now = utc_now()
            request = await expire_request(conn, request, booking, now)
            if request["status"] != "offered" or offer["status"] != "offered" or offer["expires_at"] <= now:
                # Expiry must commit, rather than roll back along with a 409 response.
                error = HTTPException(status_code=409, detail="This dispatch offer is no longer available.")
            else:
                if command.response == "accept":
                    request, now, won = await accept_winner(conn, request, booking, offer, actor)
                    if not won:
                        error = HTTPException(status_code=409, detail="This dispatch expired while waiting for assignment.")
                if error is None:
                    offer = await conn.fetchrow(
                        "UPDATE dispatch_offers SET status=$2,responded_at=$3,idempotency_key=$4 WHERE id=$1 RETURNING *",
                        offer["id"], target, now, command.idempotency_key or f"offer:{offer['id']}:{command.response}",
                    )
                    await event(conn, request["id"], booking["id"], actor, target, {"offer_id": offer["id"]})
                    await notify(conn, request, request["client_id"], target, offer["id"])
                    if target == "declined" and not await conn.fetchval("SELECT EXISTS(SELECT 1 FROM dispatch_offers WHERE dispatch_request_id=$1 AND status='offered')", request["id"]):
                        request["expires_at"] = now
                        # All declines terminate the request; a retry never resurrects it.
                        await conn.execute("UPDATE dispatch_requests SET expires_at=$2 WHERE id=$1", request["id"], now)
                        await expire_request(conn, request, booking, now)
                    result = {"status": target, "offer": public_offer(offer)}
        if error:
            raise error
        return result
    finally:
        await conn.close()


async def dispatch_user(settings: Annotated[Settings, Depends(get_settings)], credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    from .builtin_functions import require_user

    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    return await require_user(settings, credentials.credentials)


@router.post("/dispatch/requests")
async def dispatch_create_route(command: DispatchCreate, settings: Annotated[Settings, Depends(get_settings)], user: Annotated[dict[str, Any], Depends(dispatch_user)]):
    return await create_dispatch(settings, command, user)


@router.post("/dispatch/respond")
async def dispatch_respond_route(command: DispatchRespond, settings: Annotated[Settings, Depends(get_settings)], user: Annotated[dict[str, Any], Depends(dispatch_user)]):
    return await respond_to_dispatch(settings, command, user)


@router.get("/dispatch/requests/{request_id}")
async def dispatch_state_route(request_id: str, settings: Annotated[Settings, Depends(get_settings)], user: Annotated[dict[str, Any], Depends(dispatch_user)]):
    return await get_dispatch_state(settings, request_id, user)
