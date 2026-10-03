import json
import uuid
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .access_control import MODEL_SERVICE_TYPES
from .config import Settings, get_settings
from .database import connect


router = APIRouter(tags=["provider-settings"])
PACKAGES = {
    "essential": {"price": 1400, "name": "Essential", "edited_images": 10, "delivery_days": 7},
    "standard": {"price": 2200, "name": "Standard", "edited_images": 20, "delivery_days": 7},
    "professional": {"price": 3400, "name": "Professional", "edited_images": 35, "delivery_days": 7},
    "premium": {"price": 5200, "name": "Premium", "edited_images": 50, "delivery_days": 7},
    "studio": {"price": 8200, "name": "Studio", "edited_images": 75, "delivery_days": 10},
}
MODEL_SERVICE_LABELS = {
    "brand_ambassador": "Brand Ambassador", "product_shoot": "Product Shoot",
    "event_hosting": "Event Hosting / MC", "social_promo": "Social Media Promo",
    "fashion_shoot": "Fashion Shoot", "music_video": "Music Video", "film_extra": "Film / TV Extra",
}
EQUIPMENT = {
    "camera": {"mirrorless": ("Mirrorless body", 250), "dslr": ("DSLR body", 200), "cinema": ("Cinema body", 500)},
    "lenses": {"prime": ("Prime lens kit", 200), "zoom": ("Zoom lens kit", 180), "telephoto": ("Telephoto lens", 250)},
    "lighting": {"strobes": ("Strobes", 280), "continuous": ("Continuous lighting", 240), "reflectors": ("Reflectors", 120)},
    "extras": {"drone": ("Drone add-on", 450), "audio": ("Audio kit", 200), "makeup": ("Make-up artist", 800)},
}


def published_rate(value: Any) -> Decimal:
    try:
        rate = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(status_code=409, detail="This creator's published rate is invalid.")
    if not rate.is_finite() or not Decimal("0") < rate <= Decimal("100000") or rate.as_tuple().exponent < -2:
        raise HTTPException(status_code=409, detail="This creator's published rate is invalid.")
    return rate


class ModelServiceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service_type: str
    rate_zar: Decimal = Field(gt=0, le=100000, decimal_places=2, allow_inf_nan=False)

    @model_validator(mode="after")
    def supported_service(self):
        if self.service_type not in MODEL_SERVICE_TYPES:
            raise ValueError("Select a supported non-adult model service.")
        return self


class ReplaceModelServices(BaseModel):
    model_config = ConfigDict(extra="forbid")
    services: list[ModelServiceInput] = Field(max_length=len(MODEL_SERVICE_TYPES))

    @model_validator(mode="after")
    def unique_services(self):
        if len({item.service_type for item in self.services}) != len(self.services):
            raise ValueError("Each service type may appear only once.")
        return self


async def replace_model_services(settings: Settings, command: ReplaceModelServices, user: dict[str, Any]) -> dict[str, Any]:
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication is required.")
    owner = str(user["id"])
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"provider:{owner}")
            profile = await conn.fetchrow("SELECT role FROM profiles WHERE id=$1 FOR SHARE", owner)
            if not profile or profile["role"] != "model":
                raise HTTPException(status_code=403, detail="Only models can replace their services.")
            model = await conn.fetchrow("SELECT id FROM models WHERE id=$1 FOR UPDATE", owner)
            if not model:
                raise HTTPException(status_code=409, detail="Create your model profile first.")
            # Keep inactive rows to distinguish an intentionally empty catalogue from new accounts.
            await conn.execute("UPDATE model_services SET is_active=false,updated_at=now() WHERE model_id=$1", owner)
            for item in command.services:
                await conn.execute(
                    """INSERT INTO model_services (id,model_id,service_type,rate_zar,is_active,requires_age_verification)
                    VALUES ($1,$2,$3,$4,true,false) ON CONFLICT(model_id,service_type)
                    DO UPDATE SET rate_zar=excluded.rate_zar,is_active=true,requires_age_verification=false,updated_at=now()""",
                    str(uuid.uuid4()), owner, item.service_type, item.rate_zar,
                )
            return {"services": [item.model_dump() for item in command.services]}
    finally:
        await conn.close()


async def load_pricing(conn, provider: dict[str, Any], role: str) -> dict[str, Any]:
    if role == "model":
        services = await conn.fetch("SELECT service_type,rate_zar,is_active,requires_age_verification FROM model_services WHERE model_id=$1 FOR SHARE", provider["id"])
        return {**provider, "model_services": [dict(row) for row in services]}
    equipment = await conn.fetchrow("SELECT tier_id,camera_body,lenses,lighting,extras FROM photographer_equipment WHERE photographer_id=$1 FOR SHARE", provider["id"])
    return {**provider, "photographer_equipment": dict(equipment) if equipment else None}


def equipment_values(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            parsed = value
        value = parsed
    if isinstance(value, str):
        return [value]
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def booking_options(provider: dict[str, Any], role: str) -> dict[str, Any]:
    options: dict[str, Any] = {"provider_id": provider["id"], "role": role, "packages": [], "services": [], "equipment": {category: [] for category in EQUIPMENT}}
    if role == "model":
        for service in provider.get("model_services", []):
            kind = service["service_type"]
            if kind in MODEL_SERVICE_TYPES and service["is_active"] and not service.get("requires_age_verification"):
                options["services"].append({"id": kind, "label": MODEL_SERVICE_LABELS[kind], "rate_zar": published_rate(service["rate_zar"]), "pricing_basis": "session"})
        return options
    gear = provider.get("photographer_equipment") or {}
    tier = gear.get("tier_id") or provider.get("tier_id")
    custom_rate = provider.get("hourly_rate")
    # Zero is the legacy unset sentinel; a positive rate is a single published hourly offer.
    has_rate = custom_rate is not None and str(custom_rate) not in {"0", "0.0", "0.00"}
    if tier and tier not in PACKAGES:
        raise HTTPException(status_code=409, detail="This creator's published tier is invalid.")
    tiers = [tier or "standard"] if tier or has_rate else list(PACKAGES)
    for identifier in tiers:
        package = PACKAGES[identifier]
        options["packages"].append({"id": identifier, "label": package["name"], "rate_zar": published_rate(custom_rate) if has_rate else Decimal(package["price"]), "pricing_basis": "hour", "price_source": "provider_hourly_rate" if has_rate else "catalog", "edited_images": package["edited_images"], "delivery_days": package["delivery_days"]})
    for category, catalog in EQUIPMENT.items():
        values = equipment_values(gear.get("camera_body" if category == "camera" else category))
        # Free-text gear cannot truthfully identify a catalogue item or its fee.
        selected = {value.casefold() for value in values}
        options["equipment"][category] = [{"id": identifier, "label": label, "price": price} for identifier, (label, price) in catalog.items() if identifier.casefold() in selected or label.casefold() in selected]
    return options


@router.post("/providers/me/model-services")
async def save_model_services(command: ReplaceModelServices, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    from .builtin_functions import require_user

    user = await require_user(settings, request.headers.get("Authorization", "").removeprefix("Bearer "))
    return await replace_model_services(settings, command, user)


@router.get("/providers/{provider_id}/booking-options")
async def get_booking_options(provider_id: str, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    from .builtin_functions import require_user

    await require_user(settings, request.headers.get("Authorization", "").removeprefix("Bearer "))
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", f"provider:{provider_id}")
            profile = await conn.fetchrow("SELECT role FROM profiles WHERE id=$1", provider_id)
            if not profile or profile["role"] not in {"photographer", "model"}:
                raise HTTPException(status_code=404, detail="Creator profile not found.")
            role: Literal["photographer", "model"] = profile["role"]
            table = "models" if role == "model" else "photographers"
            provider = await conn.fetchrow(f"SELECT * FROM {table} WHERE id=$1 FOR SHARE", provider_id)
            if not provider:
                raise HTTPException(status_code=404, detail="Creator profile not found.")
            return booking_options(await load_pricing(conn, dict(provider), role), role)
    finally:
        await conn.close()
