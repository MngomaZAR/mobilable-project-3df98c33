import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .config import Settings, get_settings
from .database import connect
from .local_auth import user_from_access_token


router = APIRouter(tags=["reviews"])


async def published_review_summary(settings: Settings, creator_id: str) -> dict:
    conn = await connect(settings)
    try:
        creator = await conn.fetchrow(
            "SELECT id FROM profiles WHERE id=$1 AND role IN ('photographer','model') "
            "AND coalesce(deletion_status,'') NOT IN ('processing','completed')", creator_id,
        )
        if not creator:
            raise HTTPException(status_code=404, detail="Creator profile is unavailable.")
        # Aggregate the entire published set, not the first page or cached creator rating.
        row = await conn.fetchrow(
            """SELECT count(*) AS count, round(avg(r.rating)::numeric,1) AS average
            FROM reviews r JOIN bookings b ON b.id=r.booking_id
            WHERE r.moderation_status='approved' AND r.rating BETWEEN 1 AND 5
              AND coalesce(r.reviewee_id,r.photographer_id)=$1
              AND b.payment_status='paid' AND b.status IN ('completed','reviewed','paid_out')
              AND r.client_id=b.client_id AND coalesce(r.reviewer_id,r.client_id)=b.client_id
              AND coalesce(r.reviewee_id,r.photographer_id) IN (b.photographer_id,b.model_id)""",
            creator_id,
        )
        return {"count": int(row["count"]), "average": float(row["average"]) if row["average"] is not None else None}
    finally:
        await conn.close()


@router.get("/reviews/summary/{creator_id}")
async def review_summary(creator_id: str, settings: Annotated[Settings, Depends(get_settings)]):
    return await published_review_summary(settings, creator_id)


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
