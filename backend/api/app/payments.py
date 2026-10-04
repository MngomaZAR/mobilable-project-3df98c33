import hashlib
import hmac
import json
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import parse_qsl, urlencode

import httpx
from fastapi import HTTPException

from .booking_engine import enqueue, money
from .config import Settings
from .database import connect
from .service_acceptance import canary_user
from .financial_operations import FinancialConfig, capabilities as financial_capabilities


def signature(params: dict[str, Any], passphrase: str) -> str:
    fields = {key: str(value).strip() for key, value in params.items() if key != "signature" and value is not None and str(value).strip()}
    if passphrase:
        fields["passphrase"] = passphrase.strip()
    return hashlib.md5(urlencode(fields).encode()).hexdigest()


def require_configuration(settings: Settings) -> str:
    if not (settings.payfast_merchant_id and settings.payfast_merchant_key and settings.payfast_passphrase and settings.api_public_url.startswith("https://")):
        raise HTTPException(status_code=503, detail="Payments are unavailable until merchant credentials and HTTPS callbacks are configured.")
    return "https://sandbox.payfast.co.za" if settings.payfast_sandbox else "https://www.payfast.co.za"


async def checkout(settings: Settings, booking_id: str, user: dict[str, Any]) -> dict[str, str]:
    acceptance_test = settings.app_env == 'production' and canary_user(settings, user.get('id', ''))
    if not settings.payfast_checkout_enabled and not acceptance_test:
        raise HTTPException(status_code=503, detail="Payment checkout is paused while financial verification is completed. No payment has been created.")
    host = require_configuration(settings)
    if settings.app_env == 'production' and not acceptance_test:
        config = FinancialConfig.from_env()
        try:
            accepted = await financial_capabilities(settings, config)
        except Exception:
            accepted = {}
        if settings.payfast_sandbox or config.stitch_mode != 'live' or not all(
                accepted.get(key) is True for key in ('refund_execution', 'creator_payout_execution')):
            raise HTTPException(503, 'Checkout requires accepted live refunds and creator settlement. No payment has been created.')
    conn = await connect(settings)
    try:
        async with conn.transaction():
            booking = await conn.fetchrow("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", booking_id)
            if not booking:
                raise HTTPException(status_code=404, detail="Booking not found.")
            if booking["client_id"] != user["id"]:
                raise HTTPException(status_code=403, detail="Only the booking client can pay.")
            if acceptance_test and not canary_user(settings, booking['photographer_id'] or booking['model_id'] or ''):
                raise HTTPException(403, 'Controlled checkout requires a named test creator as well as a test client.')
            if booking["status"] != "accepted" or booking["payment_status"] != "unpaid":
                raise HTTPException(status_code=409, detail="The creator must accept an unpaid booking before checkout.")
            amount = money(booking["quote_amount"])
            if amount <= 0:
                raise HTTPException(status_code=409, detail="Booking has no valid server quote.")
            if acceptance_test and amount > settings.payfast_acceptance_max_amount:
                raise HTTPException(409, 'This quote exceeds the controlled acceptance-test payment limit.')
            payment = await conn.fetchrow("SELECT * FROM payments WHERE booking_id=$1 AND status='pending'", booking_id)
            mode = 'sandbox' if settings.payfast_sandbox else 'live'
            if payment and payment.get('merchant_id') and (payment['merchant_id'] != settings.payfast_merchant_id or payment.get('provider_mode') != mode):
                raise HTTPException(status_code=409, detail="Pending payment belongs to another merchant or environment.")
            if not payment:
                payment = await conn.fetchrow(
                    """INSERT INTO payments (id,booking_id,amount,currency,status,provider,description,merchant_id,provider_mode)
                    VALUES ($1,$2,$3::numeric,'ZAR','pending','payfast','Scheduled creator booking',$4,$5) RETURNING *""",
                    str(uuid.uuid4()), booking_id, amount, settings.payfast_merchant_id, mode,
                )
            elif not payment.get('merchant_id'):
                payment = await conn.fetchrow('UPDATE payments SET merchant_id=$2,provider_mode=$3 WHERE id=$1 RETURNING *', payment['id'], settings.payfast_merchant_id, mode)
            base = settings.api_public_url.rstrip("/")
            params = {
                "merchant_id": settings.payfast_merchant_id,
                "merchant_key": settings.payfast_merchant_key,
                "return_url": settings.payfast_return_url or f"{base}/payments/return",
                "cancel_url": settings.payfast_cancel_url or f"{base}/payments/cancel",
                "notify_url": f"{base}/payments/payfast/itn",
                "m_payment_id": payment["id"], "amount": f"{amount:.2f}", "item_name": "PAPZII scheduled booking",
            }
            params["signature"] = signature(params, settings.payfast_passphrase)
            return {"paymentUrl": f"{host}/eng/process?{urlencode(params)}", "paymentId": payment["id"]}
    finally:
        await conn.close()


def parse_notification(raw: bytes, settings: Settings) -> dict[str, str]:
    if len(raw) > 16384:
        raise HTTPException(status_code=413, detail="Payment notification too large.")
    try:
        pairs = parse_qsl(raw.decode("utf-8"), keep_blank_values=True, max_num_fields=80)
    except (UnicodeDecodeError, ValueError) as error:
        raise HTTPException(status_code=400, detail="Invalid payment notification.") from error
    fields = dict(pairs)
    if len(fields) != len(pairs) or not fields.get("signature") or not fields.get("pf_payment_id") or not fields.get("m_payment_id"):
        raise HTTPException(status_code=400, detail="Invalid payment notification fields.")
    if not hmac.compare_digest(signature(fields, settings.payfast_passphrase), fields["signature"]):
        raise HTTPException(status_code=400, detail="Invalid payment signature.")
    if fields.get("merchant_id") != settings.payfast_merchant_id:
        raise HTTPException(status_code=400, detail="Incorrect payment merchant.")
    return fields


async def confirm_notification(settings: Settings, raw: bytes) -> None:
    host = require_configuration(settings)
    fields = parse_notification(raw, settings)
    try:
        amount = Decimal(fields.get("amount_gross", ""))
        if not amount.is_finite() or amount <= 0 or money(amount) != amount:
            raise InvalidOperation
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=400, detail="Invalid payment amount.")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            confirmation = await client.post(f"{host}/eng/query/validate", content=urlencode({key: value for key, value in fields.items() if key != "signature"}), headers={"Content-Type": "application/x-www-form-urlencoded"})
        if confirmation.status_code != 200 or confirmation.text.strip() != "VALID":
            raise HTTPException(status_code=400, detail="Payment gateway did not validate this notification.")
    except httpx.RequestError as error:
        raise HTTPException(status_code=503, detail="Payment validation is temporarily unavailable; notification will be retried.") from error
    conn = await connect(settings)
    try:
        async with conn.transaction():
            hint = await conn.fetchrow("SELECT booking_id FROM payments WHERE id=$1", fields["m_payment_id"])
            if not hint:
                raise HTTPException(status_code=400, detail="Unknown payment.")
            booking = await conn.fetchrow("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", hint["booking_id"])
            payment = await conn.fetchrow("SELECT * FROM payments WHERE id=$1 FOR UPDATE", fields["m_payment_id"])
            if not payment or money(payment["amount"]) != amount:
                raise HTTPException(status_code=400, detail="Payment does not match the expected booking amount.")
            mode = 'sandbox' if settings.payfast_sandbox else 'live'
            if payment.get('merchant_id') != settings.payfast_merchant_id or payment.get('provider_mode') != mode:
                raise HTTPException(status_code=400, detail="Payment merchant or environment does not match.")
            if not booking or money(booking["quote_amount"]) != amount:
                raise HTTPException(status_code=400, detail="Booking does not match the payment.")
            if fields.get("payment_status") != "COMPLETE":
                return
            event = await conn.fetchrow("SELECT payment_id FROM payment_events WHERE provider_event_id=$1", fields["pf_payment_id"])
            if event:
                if event["payment_id"] != payment["id"]:
                    raise HTTPException(status_code=409, detail="Gateway transaction is already associated with another payment.")
                return
            if payment["status"] == "completed":
                return
            await conn.execute("INSERT INTO payment_events (id,payment_id,provider_event_id,event_type,payload) VALUES ($1,$2,$3,'complete',$4::jsonb)", str(uuid.uuid4()), payment["id"], fields["pf_payment_id"], json.dumps({"amount": str(amount), "status": "COMPLETE"}))
            await conn.execute("UPDATE payments SET status='completed',provider_payment_id=$2,updated_at=now() WHERE id=$1", payment["id"], fields["pf_payment_id"])
            await conn.execute("UPDATE bookings SET payment_status='paid',updated_at=now() WHERE id=$1", booking["id"])
            if booking["status"] == "cancelled":
                await conn.execute("INSERT INTO payment_incidents (id,booking_id,reason,status,amount) VALUES ($1,$2,'payment_after_cancellation','open',$3)", str(uuid.uuid4()), booking["id"], amount)
            await enqueue(conn, "notification", {"user_id": booking["photographer_id"] or booking["model_id"], "booking_id": booking["id"], "event_type": "payment_received", "title": "Booking payment confirmed", "body": "Payment has been confirmed by the payment gateway."}, f"payment:{payment['id']}:confirmed")
    finally:
        await conn.close()
