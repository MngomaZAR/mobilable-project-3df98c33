import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .config import Settings, get_settings
from .database import connect
from .local_auth import user_from_access_token


router = APIRouter(tags=["reviews"])


class ReviewInput(BaseModel):
    booking_id: str
    rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=2000)


@router.post("/reviews")
async def review_create(command: ReviewInput, request: Request, settings: Annotated[Settings, Depends(get_settings)]):
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")
    user = await user_from_access_token(settings, header.split(" ", 1)[1])
    conn = await connect(settings)
    try:
        async with conn.transaction():
            booking = await conn.fetchrow("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", command.booking_id)
            if not booking or booking["client_id"] != user["id"]:
                raise HTTPException(status_code=403, detail="Only this booking's client can review it.")
            if booking["status"] not in {"completed", "reviewed"} or booking["payment_status"] != "paid":
                raise HTTPException(status_code=409, detail="Only completed, paid bookings can be reviewed.")
            existing = await conn.fetchrow("SELECT * FROM reviews WHERE booking_id=$1 AND client_id=$2", command.booking_id, user["id"])
            if existing:
                return dict(existing)
            row = await conn.fetchrow(
                """INSERT INTO reviews (id,booking_id,client_id,photographer_id,reviewer_id,reviewee_id,rating,comment,status,moderation_status)
                VALUES ($1,$2,$3,$4,$3,$4,$5,$6,'pending','pending') RETURNING *""",
                str(uuid.uuid4()), command.booking_id, user["id"], booking["photographer_id"] or booking["model_id"], command.rating, command.comment,
            )
            return dict(row)
    finally:
        await conn.close()
