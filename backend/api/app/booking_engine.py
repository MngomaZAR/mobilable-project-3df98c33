import hashlib
import json
import math
import uuid
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .access_control import MODEL_SERVICE_TYPES, is_admin
from .config import Settings
from .database import connect
from .provider_settings import EQUIPMENT, PACKAGES, booking_options, load_pricing


ZA_TIME = timezone(timedelta(hours=2))


class BookingEquipment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    camera: list[str] = Field(default_factory=list, max_length=3)
    lenses: list[str] = Field(default_factory=list, max_length=3)
    lighting: list[str] = Field(default_factory=list, max_length=3)
    extras: list[str] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def validate_selection(self):
        for category, catalog in EQUIPMENT.items():
            values = getattr(self, category)
            if len(values) != len(set(values)) or not set(values) <= set(catalog):
                raise ValueError("Select unique catalogue equipment identifiers.")
            setattr(self, category, sorted(values))
        return self


class BookingInput(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    photographer_id: str | None = None
    model_id: str | None = None
    package_id: str | None = None
    model_service_type: str | None = None
    photography_service_type: Literal["paparazzi", "event", "photoshoot", "video"] = "photoshoot"
    equipment_selection: BookingEquipment = Field(default_factory=BookingEquipment)
    expected_total_amount: Decimal | None = Field(default=None, gt=0, decimal_places=2, allow_inf_nan=False)
    start_datetime: datetime
    end_datetime: datetime
    user_latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    user_longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    idempotency_key: str = Field(min_length=8, max_length=120)
    notes: str = Field(default="", max_length=4000)
    is_instant: bool = False

    @model_validator(mode="after")
    def validate_request(self):
        if bool(self.photographer_id) == bool(self.model_id):
            raise ValueError("Select exactly one photographer or model.")
        if not self.start_datetime.tzinfo or not self.end_datetime.tzinfo:
            raise ValueError("Booking times must include a timezone.")
        if self.end_datetime <= self.start_datetime:
            raise ValueError("Booking end must follow its start.")
        if self.end_datetime - self.start_datetime > timedelta(hours=12):
            raise ValueError("A booking cannot exceed 12 hours.")
        if self.photographer_id and self.package_id not in PACKAGES:
            raise ValueError("Unknown booking package.")
        if self.photographer_id and self.model_service_type:
            raise ValueError("Model services can only be booked with a model.")
        if self.model_service_type is not None and self.model_service_type not in MODEL_SERVICE_TYPES:
            raise ValueError("Select a supported non-adult model service.")
        if self.model_id and any(self.equipment_selection.model_dump().values()):
            raise ValueError("Photographer equipment cannot be added to model services.")
        return self


def money(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def distance_km(latitude: float, longitude: float, other_lat: float, other_lng: float) -> float:
    lat1, lat2 = math.radians(latitude), math.radians(other_lat)
    angle = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(math.radians(other_lng - longitude) / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(angle)))


def calculate_quote(settings: Settings, command: BookingInput, provider: dict[str, Any]) -> dict[str, Any]:
    if provider.get("latitude") is None or provider.get("longitude") is None:
        raise HTTPException(status_code=409, detail="This creator has not set their service location.")
    distance = distance_km(command.user_latitude, command.user_longitude, float(provider["latitude"]), float(provider["longitude"]))
    radius = float(provider.get("travel_radius") or 50)
    if distance > radius:
        raise HTTPException(status_code=409, detail="The shoot is outside this creator's service area.")
    role = "photographer" if command.photographer_id else "model"
    options = booking_options({"id": command.photographer_id or command.model_id, **provider}, role)
    hours = Decimal(str((command.end_datetime - command.start_datetime).total_seconds())) / Decimal("3600")
    equipment_amount = Decimal("0")
    if role == "model":
        offer = next((item for item in options["services"] if item["id"] == command.model_service_type), None)
        if not offer:
            raise HTTPException(status_code=409, detail="Select an active, supported model service with a published rate.")
        base_amount = money(offer["rate_zar"])
        edited_images, delivery_days = None, None
    else:
        if command.photography_service_type == "video":
            raise HTTPException(status_code=409, detail="This creator has no published video offer. Choose photography.")
        offer = next((item for item in options["packages"] if item["id"] == command.package_id), None)
        if not offer:
            raise HTTPException(status_code=409, detail="Choose this creator's published package.")
        base_amount = money(offer["rate_zar"] * hours)
        edited_images, delivery_days = offer["edited_images"], offer["delivery_days"]
        for category, selections in command.equipment_selection.model_dump().items():
            available = {item["id"]: item for item in options["equipment"][category]}
            if not set(selections) <= set(available):
                raise HTTPException(status_code=409, detail="This creator has not published the selected equipment.")
            equipment_amount += sum((Decimal(available[item]["price"]) for item in selections), Decimal("0"))
    equipment_amount = money(equipment_amount)
    travel_amount = money(distance * 12)
    total = base_amount + equipment_amount + travel_amount
    rate = Decimal(str(settings.commission_rate))
    if not rate.is_finite() or not Decimal("0") <= rate <= Decimal("1"):
        raise HTTPException(status_code=503, detail="Booking commission is not configured correctly.")
    commission = money(total * rate)
    return {"currency": "ZAR", "provider_id": command.photographer_id or command.model_id, "total_amount": total, "commission_amount": commission, "payout_amount": total - commission,
            "distance_km": round(distance, 2), "package_name": offer["label"], "edited_images": edited_images, "delivery_days": delivery_days,
            "base_amount": base_amount, "equipment_amount": equipment_amount, "travel_amount": travel_amount,
            "unit_rate": offer["rate_zar"], "pricing_basis": offer["pricing_basis"], "commission_rate": rate,
            "price_source": offer.get("price_source", "model_service"), "model_service_type": command.model_service_type,
            "package_id": command.package_id if role == "photographer" else None,
            "photography_service_type": command.photography_service_type if role == "photographer" else None,
            "equipment_selection": command.equipment_selection.model_dump()}


def fingerprint(command: BookingInput) -> str:
    body = command.model_dump(mode="json", exclude={"idempotency_key"})
    # Preserve retry hashes for pre-migration bookings with no new selections.
    for field, default in {"model_service_type": None, "photography_service_type": "photoshoot", "expected_total_amount": None}.items():
        if body.get(field) == default:
            body.pop(field)
    if not any(body["equipment_selection"].values()):
        body.pop("equipment_selection")
    if "expected_total_amount" in body:
        body["expected_total_amount"] = str(money(command.expected_total_amount))
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


async def enqueue(conn, kind: str, payload: dict[str, Any], dedupe_key: str) -> None:
    await conn.execute(
        "INSERT INTO job_outbox (id, kind, payload, dedupe_key, status, attempts, max_attempts, available_at) VALUES ($1,$2,$3::jsonb,$4,'pending',0,8,now()) ON CONFLICT (dedupe_key) DO NOTHING",
        str(uuid.uuid4()), kind, json.dumps(payload), dedupe_key,
    )


async def load_provider(conn, command: BookingInput, include_pricing: bool = True) -> dict[str, Any]:
    provider_id = command.photographer_id or command.model_id
    profile = await conn.fetchrow("SELECT id, role, verified, kyc_status, age_verified FROM profiles WHERE id=$1", provider_id)
    expected_role = "photographer" if command.photographer_id else "model"
    if not profile or profile["role"] != expected_role or not (profile["verified"] or profile["kyc_status"] == "approved") or not profile["age_verified"]:
        raise HTTPException(status_code=409, detail="This creator is not verified for bookings.")
    table = "photographers" if command.photographer_id else "models"
    row = await conn.fetchrow(f"SELECT * FROM {table} WHERE id=$1 FOR SHARE", provider_id)
    if not row:
        raise HTTPException(status_code=404, detail="Creator profile not found.")
    return await load_pricing(conn, dict(row), expected_role) if include_pricing else dict(row)


async def require_open_booking_parties(conn, *user_ids: str) -> None:
    # Lazy import keeps booking -> dispatch -> booking initialization acyclic.
    from .dispatch_engine import require_open_account

    if any(not user_id for user_id in user_ids):
        raise HTTPException(status_code=403, detail="Active stored booking parties are required.")
    for user_id in sorted(set(user_ids)):
        await require_open_account(conn, user_id)


async def quote_booking(settings: Settings, command: BookingInput, user: dict[str, Any]) -> dict[str, Any]:
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication is required.")
    if (command.photographer_id or command.model_id) == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot book yourself.")
    if command.is_instant:
        raise HTTPException(status_code=409, detail="Instant booking is not available in this release. Choose a scheduled shoot.")
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"provider:{command.photographer_id or command.model_id}")
            await require_open_booking_parties(conn, user["id"], command.photographer_id or command.model_id)
            provider = await load_provider(conn, command)
            return calculate_quote(settings, command, provider)
    finally:
        await conn.close()


async def check_availability(conn, command: BookingInput, provider_id: str, exclude_id: str | None = None) -> None:
    local_start = command.start_datetime.astimezone(ZA_TIME)
    local_end = command.end_datetime.astimezone(ZA_TIME)
    if local_start.date() != local_end.date():
        raise HTTPException(status_code=409, detail="Bookings must fit within one availability day.")
    blocked = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM blocked_dates WHERE user_id=$1 AND blocked_date::date=$2)", provider_id, local_start.date())
    slot = await conn.fetchrow("SELECT start_time, end_time FROM availability WHERE user_id=$1 AND day_of_week=$2 AND is_available=true", provider_id, (local_start.weekday() + 1) % 7)
    if blocked or not slot:
        raise HTTPException(status_code=409, detail="This creator is unavailable on that day.")
    if not (str(slot["start_time"])[:5] <= local_start.strftime("%H:%M") and local_end.strftime("%H:%M") <= str(slot["end_time"])[:5]):
        raise HTTPException(status_code=409, detail="Choose a time within the creator's published availability.")
    overlap = await conn.fetchval(
        """SELECT EXISTS(SELECT 1 FROM bookings WHERE (photographer_id=$1 OR model_id=$1)
        AND start_datetime < $3 AND end_datetime > $2 AND ($4::text IS NULL OR id<>$4)
        AND (status IN ('accepted','in_progress') OR (status='pending' AND hold_expires_at > now())))""",
        provider_id, command.start_datetime, command.end_datetime, exclude_id,
    )
    if overlap:
        raise HTTPException(status_code=409, detail="This creator already has an overlapping booking.")


async def create_booking(settings: Settings, command: BookingInput, user: dict[str, Any]) -> dict[str, Any]:
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication is required.")
    if command.is_instant:
        raise HTTPException(status_code=409, detail="Instant booking is not available in this release.")
    provider_id = command.photographer_id or command.model_id
    if provider_id == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot book yourself.")
    request_hash = fingerprint(command)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await require_open_booking_parties(conn, user["id"], provider_id)
            # Serialize both request retries and competing bookings for a creator.
            await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"request:{user['id']}:{command.idempotency_key}")
            existing = await conn.fetchrow("SELECT * FROM bookings WHERE client_id=$1 AND idempotency_key=$2", user["id"], command.idempotency_key)
            if existing:
                if existing["request_fingerprint"] != request_hash:
                    raise HTTPException(status_code=409, detail="This request key has already been used for a different booking.")
                return dict(existing)
            if command.start_datetime < datetime.now(UTC):
                raise HTTPException(status_code=400, detail="Choose a future booking time.")
            await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"provider:{provider_id}")
            provider = await load_provider(conn, command)
            await check_availability(conn, command, str(provider_id))
            quote = calculate_quote(settings, command, provider)
            if command.expected_total_amount is not None and money(command.expected_total_amount) != quote["total_amount"]:
                raise HTTPException(status_code=409, detail="This creator's price changed. Refresh the quote before booking.")
            row = await conn.fetchrow(
                """INSERT INTO bookings (id,client_id,photographer_id,model_id,package_id,package_type,service_type,
                start_datetime,end_datetime,booking_date,user_latitude,user_longitude,notes,status,payment_status,
                price_total,total_amount,quote_amount,commission_amount,photographer_payout,payout_amount,distance_km,
                idempotency_key,request_fingerprint,hold_expires_at,is_instant,assignment_state,
                model_service_type,photography_service_type,equipment_selection,pricing_snapshot)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending','unpaid',
                $14::numeric,$14::numeric,$14::numeric,$15::numeric,$16::numeric,$16::numeric,$17,$18,$19,now()+interval '24 hours',false,'queued',
                $20,$21,$22::jsonb,$23::jsonb) RETURNING *""",
                str(uuid.uuid4()), user["id"], command.photographer_id, command.model_id, quote["package_id"],
                quote["package_name"], "photography" if command.photographer_id else "modeling",
                command.start_datetime, command.end_datetime, command.start_datetime.astimezone(ZA_TIME).date().isoformat(),
                command.user_latitude, command.user_longitude, command.notes,
                quote["total_amount"], quote["commission_amount"], quote["payout_amount"], money(quote["distance_km"]),
                command.idempotency_key, request_hash,
                quote["model_service_type"], quote["photography_service_type"], json.dumps(quote["equipment_selection"]),
                json.dumps({"version": 1, **quote}, default=str),
            )
            await enqueue(conn, "notification", {"user_id": provider_id, "event_type": "booking_request", "booking_id": row["id"], "title": "New booking request", "body": "Review the shoot details and respond."}, f"booking:{row['id']}:request")
            return dict(row)
    finally:
        await conn.close()


class BookingTransition(BaseModel):
    status: Literal["accepted", "declined", "cancelled", "in_progress", "completed"]


async def transition_booking(settings: Settings, booking_id: str, target: str, user: dict[str, Any]) -> dict[str, Any]:
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication is required.")
    conn = await connect(settings)
    try:
        async with conn.transaction():
            row = await conn.fetchrow("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", booking_id)
            if not row:
                raise HTTPException(status_code=404, detail="Booking not found.")
            provider = row["model_id"] or row["photographer_id"]
            actor = user["id"]
            if actor not in {row["client_id"], provider} and not is_admin(settings, user):
                raise HTTPException(status_code=403, detail="This booking belongs to other users.")
            if row["status"] == target:
                return dict(row)
            allowed = {"pending": {"accepted", "declined", "cancelled"}, "accepted": {"in_progress", "completed", "cancelled"}, "in_progress": {"completed"}}
            if target not in allowed.get(row["status"], set()):
                raise HTTPException(status_code=409, detail="This booking status transition is not allowed.")
            if target != "cancelled" and actor != provider and not is_admin(settings, user):
                raise HTTPException(status_code=403, detail="Only the booked creator can perform this action.")
            if target == "accepted" and row["hold_expires_at"] and row["hold_expires_at"] <= datetime.now(UTC):
                raise HTTPException(status_code=409, detail="This booking request has expired.")
            if target == "accepted":
                if row.get("dispatch_request_id"):
                    raise HTTPException(status_code=409, detail="Accept your own dispatch offer instead of the scheduled booking command.")
                await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"provider:{provider}")
                await require_open_booking_parties(conn, actor, row["client_id"], provider)
                values = {key: row[key] for key in BookingInput.model_fields if key in row and row[key] is not None}
                if isinstance(values.get("equipment_selection"), str):
                    values["equipment_selection"] = json.loads(values["equipment_selection"])
                command = BookingInput(**values)
                await load_provider(conn, command, include_pricing=False)
                await check_availability(conn, command, provider, booking_id)
            if target in {"in_progress", "completed"}:
                if row["payment_status"] != "paid":
                    raise HTTPException(status_code=409, detail="Payment must be confirmed before the shoot starts or completes.")
                if row["start_datetime"] > datetime.now(UTC):
                    raise HTTPException(status_code=409, detail="The scheduled shoot has not started yet.")
                if target == "completed" and row["end_datetime"] > datetime.now(UTC):
                    raise HTTPException(status_code=409, detail="The scheduled shoot has not ended yet.")
            updated = await conn.fetchrow("UPDATE bookings SET status=$2, updated_at=now(), accepted_at=CASE WHEN $2='accepted' THEN now() ELSE accepted_at END, completed_at=CASE WHEN $2='completed' THEN now() ELSE completed_at END WHERE id=$1 RETURNING *", booking_id, target)
            await conn.execute("INSERT INTO booking_events (id,booking_id,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5::jsonb)", str(uuid.uuid4()), booking_id, actor, target, json.dumps({"previous_status": row["status"]}))
            if target == "completed":
                await conn.execute("INSERT INTO earnings (id,booking_id,user_id,amount,status) VALUES ($1,$2,$3,$4,'pending') ON CONFLICT (booking_id) DO NOTHING", str(uuid.uuid4()), booking_id, provider, money(row["payout_amount"]))
                await conn.execute("INSERT INTO payout_requests (id,booking_id,user_id,amount,status) VALUES ($1,$2,$3,$4,'pending_delivery') ON CONFLICT (booking_id) DO NOTHING", str(uuid.uuid4()), booking_id, provider, money(row["payout_amount"]))
            if target == "cancelled" and row["payment_status"] == "paid":
                await conn.execute("INSERT INTO payment_incidents (id,booking_id,reason,status,amount) VALUES ($1,$2,'refund_requested','open',$3)", str(uuid.uuid4()), booking_id, money(row["quote_amount"]))
            recipient = provider if actor == row["client_id"] else row["client_id"]
            await enqueue(conn, "notification", {"user_id": recipient, "event_type": f"booking_{target}", "booking_id": booking_id, "title": "Booking updated", "body": f"Your booking is {target.replace('_', ' ')}."}, f"booking:{booking_id}:{target}")
            return dict(updated)
    finally:
        await conn.close()
