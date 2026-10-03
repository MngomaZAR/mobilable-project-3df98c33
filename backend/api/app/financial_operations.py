"""Server-owned ZAR operations. No capability or settlement is inferred from a mock.

PayFast: https://developers.payfast.co.za/api (refunds, not creator transfers).
Stitch: https://docs.stitch.money/payment-products/payouts/rest
Integration: mount create_financial_router with the application's authenticated user
dependency. Keep these tables out of generic table APIs, including administrator reads.
"""

import base64
import hashlib
import hmac
import json
import os
import re
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Callable
from urllib.parse import quote, urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Body, Depends, HTTPException, Request

from .access_control import is_admin, require_admin
from .config import Settings
from .database import connect


ACTIVE = ('pending_approval', 'approved', 'executing', 'unknown', 'submitted', 'paused')
RECONCILABLE = ('executing', 'unknown', 'submitted', 'paused', 'completed')
CENT = Decimal('0.01')
# Supported, non-deprecated values in Stitch's DisbursementBankBeneficiaryBankId.
# https://docs.stitch.money/api/enums/disbursement-bank-beneficiary-bank-id
STITCH_BANK_IDS = frozenset((
    'absa', 'african_bank', 'capitec', 'discovery_bank', 'fnb', 'grindrod_bank', 'investec',
    'nedbank', 'sasfin_bank', 'standard_bank', 'tymebank', 'za_bidvest', 'za_access_bank',
    'za_citibank', 'za_u_bank', 'za_jp_morgan_chase_bank', 'za_mercantile_bank', 'za_capitec_business',
    'za_postbank', 'za_hbz_bank', 'za_old_mutual_bank', 'za_olympus_mobile', 'za_hsbc',
    'za_vbs_mutual_bank', 'za_finbond_mutual_bank', 'za_finbond_net1', 'za_habib_overseas_bank',
    'za_people_bank', 'za_standard_chartered_bank', 'za_unibank', 'za_albaraka_bank',
    'za_state_bank_of_india', 'za_bank_zero', 'za_bank_zero_mukuru',
))


@dataclass(frozen=True)
class FinancialConfig:
    bank_encryption_key: str = field(default='', repr=False)
    payfast_refunds_enabled: bool = False
    refund_acceptance_id: str = ''
    stitch_client_id: str = ''
    stitch_client_secret: str = field(default='', repr=False)
    stitch_webhook_secret: str = field(default='', repr=False)
    stitch_mode: str = ''
    stitch_payouts_enabled: bool = False
    payout_acceptance_id: str = ''

    @classmethod
    def from_env(cls):
        return cls(
            bank_encryption_key=os.getenv('FINANCIAL_BANK_ENCRYPTION_KEY', ''),
            payfast_refunds_enabled=os.getenv('PAYFAST_REFUNDS_ENABLED', '').lower() == 'true',
            refund_acceptance_id=os.getenv('FINANCIAL_REFUND_ACCEPTANCE_ID', ''),
            stitch_client_id=os.getenv('STITCH_CLIENT_ID', ''),
            stitch_client_secret=os.getenv('STITCH_CLIENT_SECRET', ''),
            stitch_webhook_secret=os.getenv('STITCH_WEBHOOK_SECRET', ''),
            stitch_mode=os.getenv('STITCH_MODE', ''),
            stitch_payouts_enabled=os.getenv('STITCH_PAYOUTS_ENABLED', '').lower() == 'true',
            payout_acceptance_id=os.getenv('FINANCIAL_PAYOUT_ACCEPTANCE_ID', ''),
        )


def zar(value: Any, *, positive=True) -> Decimal:
    try:
        if isinstance(value, bool) or value is None:
            raise ValueError
        amount = Decimal(str(value))
        if not amount.is_finite() or abs(amount) > Decimal('999999999999.99') or amount != amount.quantize(CENT):
            raise ValueError
        if positive and amount <= 0:
            raise ValueError
        return amount.quantize(CENT)
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(400, 'A finite ZAR amount with at most two decimal places is required.') from None


def text(value: Any, name: str, minimum=1, maximum=120) -> str:
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum or any(ord(c) < 32 for c in value):
        raise HTTPException(400, f'Invalid {name}.')
    return value.strip()


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def public_operation(row) -> dict[str, Any]:
    return {key: (f'{row[key]:.2f}' if key == 'amount' else row[key]) for key in (
        'id', 'kind', 'user_id', 'booking_id', 'amount', 'currency', 'status', 'created_at', 'updated_at')}


def cipher(config: FinancialConfig) -> Fernet:
    try:
        return Fernet(config.bank_encryption_key.encode())
    except (ValueError, TypeError):
        raise HTTPException(503, 'Bank detail encryption is not configured.') from None


def bank_digest(config: FinancialConfig, details: dict) -> str:
    return hmac.new(base64.urlsafe_b64decode(config.bank_encryption_key), canonical(details), hashlib.sha256).hexdigest()


def decode_bank(config: FinancialConfig, row) -> dict:
    try:
        details = json.loads(cipher(config).decrypt(bytes(row['encrypted_details'])))
        if details['method_id'] != row['method_id'] or details['user_id'] != row['user_id']:
            raise ValueError
        if not hmac.compare_digest(bank_digest(config, details), row['details_digest']):
            raise ValueError
        return details
    except (InvalidToken, ValueError, KeyError, TypeError):
        raise HTTPException(409, 'The bank method must be reverified.') from None


async def _bank(conn, config, method_id, owner_id, expected_digest=None):
    row = await conn.fetchrow('SELECT * FROM financial_bank_accounts WHERE method_id=$1 FOR UPDATE', method_id)
    if not row or row['user_id'] != owner_id:
        raise HTTPException(403, 'The bank method must belong to the recipient.')
    if row['revoked_at'] or not row['verified_at'] or row['verified_digest'] != row['details_digest']:
        raise HTTPException(409, 'A verified bank method is required.')
    if expected_digest is not None and expected_digest != row['details_digest']:
        raise HTTPException(409, 'Bank details changed after reservation.')
    return decode_bank(config, row), row['details_digest']


async def _lock_bank_owner(conn, owner_id, *, allowed_deletion_statuses=()):
    account = await conn.fetchrow('SELECT metadata FROM api_users WHERE id=$1 FOR UPDATE', owner_id)
    if not account:
        raise HTTPException(403, 'The bank method owner account is unavailable.')
    metadata = json.loads(account['metadata']) if isinstance(account['metadata'], str) else account['metadata']
    if not isinstance(metadata, dict):
        raise HTTPException(409, 'Account state requires reconciliation.')
    if metadata.get('deletion_status') and metadata['deletion_status'] not in allowed_deletion_statuses:
        raise HTTPException(409, 'Account deletion prevents this financial mutation.')
    await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', f'financial-bank:{owner_id}')


def public_bank_method(row):
    masked = row.get('account_masked')
    last_four = re.search(r'[0-9]{4}$', masked) if isinstance(masked, str) else None
    return {'id': row['id'], 'bank_name': row['bank_name'],
            'account_masked': f'****{last_four[0]}' if last_four else '****',
            'verified': bool(row.get('verified')), 'is_default': bool(row.get('is_default'))}


async def _owned_method(conn, owner, method_id):
    row = await conn.fetchrow('SELECT * FROM payout_methods WHERE id=$1 AND user_id=$2 FOR UPDATE', method_id, owner)
    if not row:
        raise HTTPException(404, 'Bank method not found.')
    return row


async def list_bank_methods(settings, user):
    owner = text(user.get('id'), 'user')
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await _lock_bank_owner(conn, owner, allowed_deletion_statuses=('pending', 'blocked'))
            rows = await conn.fetch('''SELECT m.id,m.bank_name,m.account_masked,
                coalesce(to_jsonb(m)->>'is_default','false')='true' AS is_default,
                (b.user_id=m.user_id AND b.verified_at IS NOT NULL AND b.verified_digest=b.details_digest
                 AND b.revoked_at IS NULL) AS verified
                FROM payout_methods m LEFT JOIN financial_bank_accounts b ON b.method_id=m.id
                WHERE m.user_id=$1 AND m.bank_name IS NOT NULL AND m.account_masked IS NOT NULL
                AND b.revoked_at IS NULL ORDER BY m.created_at,m.id''', owner)
            return [public_bank_method(row) for row in rows]
    finally:
        await conn.close()


async def set_default_bank_method(settings, config, user, method_id):
    owner = text(user.get('id'), 'user')
    method_id = text(method_id, 'method id')
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await _lock_bank_owner(conn, owner)
            method = await _owned_method(conn, owner, method_id)
            if 'is_default' not in method:
                raise HTTPException(503, 'Bank method defaults require the payout_methods.is_default migration.')
            try:
                await _bank(conn, config, method_id, owner)
            except HTTPException as error:
                if error.status_code == 403:
                    raise HTTPException(409, 'Re-add and independently verify this bank method before selecting it.') from None
                raise
            await conn.execute('UPDATE payout_methods SET is_default=false,updated_at=now() WHERE user_id=$1', owner)
            method = await conn.fetchrow('UPDATE payout_methods SET is_default=true,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *', method_id, owner)
            return public_bank_method(method)
    finally:
        await conn.close()


async def _ensure_bank_releasable(conn, owner, method_id):
    active = await conn.fetchval('SELECT EXISTS(SELECT 1 FROM financial_operations WHERE method_id=$1 AND status=ANY($2::text[]))', method_id, list(ACTIVE))
    legacy_pending = await conn.fetchval('''SELECT EXISTS(SELECT 1 FROM payout_requests
        WHERE (payout_method_id=$1 OR (user_id=$2 AND payout_method_id IS NULL))
        AND coalesce(status,'pending') NOT IN ('paid','completed','cancelled','rejected','failed','reversed'))''', method_id, owner)
    if active or legacy_pending:
        raise HTTPException(409, 'Resolve active financial operations and pending payout requests before revoking this method.')


async def _disable_bank_method(conn, owner, method_id, method):
    await conn.execute('UPDATE financial_bank_accounts SET revoked_at=coalesce(revoked_at,now()),verified_at=NULL,verified_digest=NULL WHERE method_id=$1', method_id)
    await conn.execute('''UPDATE payout_methods SET verified=false,account_holder=NULL,branch_code=NULL,
        account_type=NULL,bank_name=NULL,account_masked=NULL,updated_at=now() WHERE id=$1 AND user_id=$2''', method_id, owner)
    if 'is_default' in method:
        await conn.execute('UPDATE payout_methods SET is_default=false,updated_at=now() WHERE id=$1 AND user_id=$2', method_id, owner)


async def revoke_bank_method(settings, user, method_id):
    owner = text(user.get('id'), 'user')
    method_id = text(method_id, 'method id')
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await _lock_bank_owner(conn, owner)
            method = await _owned_method(conn, owner, method_id)
            private = await conn.fetchrow('SELECT * FROM financial_bank_accounts WHERE method_id=$1 FOR UPDATE', method_id)
            if private and private['user_id'] != owner:
                raise HTTPException(409, 'Bank method ownership requires reconciliation.')
            await _ensure_bank_releasable(conn, owner, method_id)
            references = await conn.fetchval('''SELECT
                EXISTS(SELECT 1 FROM financial_operations WHERE method_id=$1)
                OR EXISTS(SELECT 1 FROM payout_requests WHERE payout_method_id=$1)''', method_id)
            if references:
                # Retain ciphertext for referenced history, but never authorize a new transfer.
                await _disable_bank_method(conn, owner, method_id, method)
            else:
                await conn.execute('DELETE FROM financial_bank_accounts WHERE method_id=$1', method_id)
                await conn.execute('DELETE FROM payout_methods WHERE id=$1 AND user_id=$2', method_id, owner)
            return {'id': method_id, 'revoked': True}
    finally:
        await conn.close()


async def reject_bank_method(settings, admin, method_id, reason):
    """Independent admin rejection reference; does not certify account verification."""
    require_admin(settings, admin)
    method_id = text(method_id, 'method id')
    reference = text(reason, 'bank rejection reference', 8, 255)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            hint = await conn.fetchrow('SELECT * FROM financial_bank_accounts WHERE method_id=$1', method_id)
            if not hint:
                raise HTTPException(409, 'Secure bank review requires an encrypted bank method.')
            owner = hint['user_id']
            if owner == admin['id']:
                raise HTTPException(403, 'Independent bank review is required.')
            await _lock_bank_owner(conn, owner, allowed_deletion_statuses=('pending', 'blocked'))
            method = await _owned_method(conn, owner, method_id)
            row = await conn.fetchrow('SELECT * FROM financial_bank_accounts WHERE method_id=$1 FOR UPDATE', method_id)
            if not row or row['user_id'] != owner:
                raise HTTPException(409, 'Bank method ownership requires reconciliation.')
            if 'review_decision' not in row:
                raise HTTPException(503, 'Audited bank review requires migration 012.')
            await _ensure_bank_releasable(conn, owner, method_id)
            if row['review_decision'] == 'rejected':
                if row['review_reference'] != reference:
                    raise HTTPException(409, 'Bank rejection has already been recorded with another reference.')
                return {'id': method_id, 'verified': False, 'revoked': True}
            await _disable_bank_method(conn, owner, method_id, method)
            await conn.execute("UPDATE financial_bank_accounts SET review_decision='rejected',review_reference=$2,reviewed_by=$3,reviewed_at=now() WHERE method_id=$1", method_id, reference, admin['id'])
            return {'id': method_id, 'verified': False, 'revoked': True}
    finally:
        await conn.close()


async def add_bank_method(settings, config, user, payload):
    owner = text(user.get('id'), 'user')
    method_id = str(uuid.uuid4())
    details = {'method_id': method_id, 'user_id': owner,
               'account_holder': text(payload.get('account_holder'), 'account holder', 2, 120),
               'account_number': text(payload.get('account_number'), 'account number', 4, 12),
               'bank_id': text(payload.get('bank_id'), 'bank id', 2, 60),
               'account_type': payload.get('account_type'),
               'payfast_bank_name': payload.get('payfast_bank_name') or '',
               'branch_code': payload.get('branch_code') or ''}
    if not re.fullmatch(r'[0-9]{4,12}', details['account_number']) or details['bank_id'] not in STITCH_BANK_IDS:
        raise HTTPException(400, 'Invalid bank identifiers.')
    if details['account_type'] not in ('current', 'savings'):
        raise HTTPException(400, 'Invalid bank account type.')
    if details['payfast_bank_name']:
        details['payfast_bank_name'] = text(details['payfast_bank_name'], 'refund bank name', 2, 60)
        if not isinstance(details['branch_code'], str) or not re.fullmatch(r'[0-9]{6}', details['branch_code']):
            raise HTTPException(400, 'A six-digit refund branch code is required.')
    encrypted = cipher(config).encrypt(canonical(details))
    digest = bank_digest(config, details)
    masked = f"****{details['account_number'][-4:]}"
    conn = await connect(settings)
    try:
        async with conn.transaction():
            await _lock_bank_owner(conn, owner)
            await conn.execute("INSERT INTO payout_methods (id,user_id,bank_name,account_masked,verified) VALUES ($1,$2,$3,$4,false)", method_id, owner, details['bank_id'], masked)
            await conn.execute('INSERT INTO financial_bank_accounts (method_id,user_id,encrypted_details,details_digest) VALUES ($1,$2,$3,$4)', method_id, owner, encrypted, digest)
        return {'id': method_id, 'account_masked': masked, 'bank_name': details['bank_id'], 'verified': False, 'is_default': False}
    finally:
        await conn.close()


async def verify_bank_method(settings, config, admin, method_id, evidence_reference):
    """Admin attestation of independent account/owner verification, not a BAV claim.

    Reference an independently reviewed BAV/ownership document in private storage.
    A boolean from the creator or a legacy payout_methods.verified flag is insufficient.
    """
    require_admin(settings, admin)
    method_id = text(method_id, 'method id')
    reference = text(evidence_reference, 'bank verification reference', 8, 255)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            hint = await conn.fetchrow('SELECT * FROM financial_bank_accounts WHERE method_id=$1', method_id)
            if not hint:
                raise HTTPException(404, 'Bank method not found.')
            await _lock_bank_owner(conn, hint['user_id'], allowed_deletion_statuses=('pending', 'blocked'))
            await _owned_method(conn, hint['user_id'], method_id)
            row = await conn.fetchrow('SELECT * FROM financial_bank_accounts WHERE method_id=$1 FOR UPDATE', method_id)
            if not row or row['user_id'] != hint['user_id']:
                raise HTTPException(404, 'Bank method not found.')
            if row['user_id'] == admin['id'] or row['revoked_at']:
                raise HTTPException(403, 'Independent bank verification is required.')
            if 'review_decision' not in row:
                raise HTTPException(503, 'Audited bank review requires migration 012.')
            decode_bank(config, row)
            await conn.execute("UPDATE financial_bank_accounts SET verified_digest=details_digest,verified_by=$2,verification_reference=$3,verified_at=now(),review_decision='verified',reviewed_by=$2,review_reference=$3,reviewed_at=now() WHERE method_id=$1", method_id, admin['id'], reference)
            await conn.execute('UPDATE payout_methods SET verified=true,updated_at=now() WHERE id=$1', method_id)
        return {'id': method_id, 'verified': True}
    finally:
        await conn.close()


def _identity(settings, config, kind):
    if kind == 'refund':
        return 'payfast', settings.payfast_merchant_id, 'sandbox' if settings.payfast_sandbox else 'live', config.refund_acceptance_id
    return 'stitch', config.stitch_client_id, config.stitch_mode, config.payout_acceptance_id


async def _ready(conn, settings, config, kind):
    provider, account, mode, evidence_id = _identity(settings, config, kind)
    configured = (config.payfast_refunds_enabled and settings.payfast_merchant_id and settings.payfast_passphrase) if kind == 'refund' else (
        config.stitch_payouts_enabled and config.stitch_client_id and config.stitch_client_secret
        and config.stitch_webhook_secret and config.bank_encryption_key)
    if not configured or not evidence_id or mode not in ('sandbox', 'live'):
        return False
    if kind == 'payout':
        try:
            cipher(config)
            if not config.stitch_webhook_secret.startswith('whsec_') or len(base64.b64decode(config.stitch_webhook_secret[6:], validate=True)) < 16:
                return False
        except (HTTPException, ValueError):
            return False
    return bool(await conn.fetchval('''SELECT EXISTS(SELECT 1 FROM financial_provider_acceptance
        WHERE id=$1 AND provider=$2 AND operation_kind=$3 AND provider_account=$4 AND mode=$5
        AND revoked_at IS NULL AND accepted_at<=now())''', evidence_id, provider, kind, account, mode))


async def capabilities(settings, config):
    conn = await connect(settings)
    try:
        return {'refund_execution': await _ready(conn, settings, config, 'refund'),
                'creator_payout_execution': await _ready(conn, settings, config, 'payout')}
    finally:
        await conn.close()


async def get_operation(settings, user, operation_id):
    conn = await connect(settings)
    try:
        row = await conn.fetchrow('SELECT * FROM financial_operations WHERE id=$1', operation_id)
        if not row or (row['user_id'] != user['id'] and row['actor_id'] != user['id'] and not is_admin(settings, user)):
            raise HTTPException(404, 'Financial operation not found.')
        return public_operation(row)
    finally:
        await conn.close()


async def _resources(conn, booking_id):
    # Financial callers take the owner advisory lock before this shared ITN row order.
    booking = await conn.fetchrow('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', booking_id)
    if not booking:
        raise HTTPException(404, 'Booking not found.')
    payment = await conn.fetchrow("SELECT * FROM payments WHERE booking_id=$1 AND status='completed' FOR UPDATE", booking_id)
    if not payment or payment['currency'] != 'ZAR' or payment['provider'] != 'payfast' or not payment['provider_payment_id']:
        raise HTTPException(409, 'A confirmed ZAR payment is required.')
    confirmed = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM payment_events WHERE payment_id=$1 AND provider_event_id=$2 AND event_type='complete')", payment['id'], payment['provider_payment_id'])
    if not confirmed or zar(payment['amount']) != zar(booking['quote_amount']):
        raise HTTPException(409, 'The original payment requires reconciliation.')
    earning = await conn.fetchrow('SELECT * FROM earnings WHERE booking_id=$1 FOR UPDATE', booking_id)
    refunded = zar(payment['refunded_amount'], positive=False)
    if refunded < 0 or refunded > payment['amount'] or (booking['payment_status'] == 'refunded' and refunded != payment['amount']):
        raise HTTPException(409, 'The legacy refund balance requires reconciliation.')
    if earning:
        paid = zar(earning['paid_amount'], positive=False)
        net = zar(earning['amount'], positive=False) - zar(earning['refunded_amount'], positive=False)
        if paid < 0 or net < 0 or paid > net or (earning['status'] in ('paid', 'partially_paid') and not paid and net):
            raise HTTPException(409, 'The legacy creator balance requires reconciliation.')
    legacy = await conn.fetchrow('SELECT status FROM payout_requests WHERE booking_id=$1 FOR UPDATE', booking_id)
    if legacy and legacy['status'] not in (None, 'pending_delivery'):
        managed = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM financial_operations WHERE booking_id=$1 AND kind='payout' AND attempt_count=1)", booking_id)
        if not managed:
            raise HTTPException(409, 'The legacy payout request requires reconciliation.')
    return dict(booking), dict(payment), dict(earning) if earning else None


def creator_share(booking, payment, refund_amount):
    payout = zar(booking['payout_amount'], positive=False)
    gross = zar(payment['amount'])
    if payout < 0 or payout > gross:
        raise HTTPException(409, 'Invalid booking payout allocation.')
    return (payout * refund_amount / gross).quantize(CENT, rounding=ROUND_HALF_UP)


async def request_operation(settings, config, user, kind, payload):
    if kind not in ('refund', 'payout'):
        raise HTTPException(400, 'Unsupported financial operation.')
    actor = text(user.get('id'), 'user')
    booking_id = text(payload.get('booking_id'), 'booking id')
    key = text(payload.get('idempotency_key'), 'idempotency key')
    amount = zar(payload.get('amount'))
    reason = text(payload.get('reason') if kind == 'refund' else payload.get('reason', 'Creator payout'), 'reason', 3, 255)
    method_id = text(payload['method_id'], 'method id') if payload.get('method_id') else None
    fingerprint = hashlib.sha256(canonical({'kind': kind, 'booking_id': booking_id, 'amount': str(amount), 'reason': reason, 'method_id': method_id})).hexdigest()
    conn = await connect(settings)
    try:
        async with conn.transaction():
            hint = await conn.fetchrow('SELECT * FROM bookings WHERE id=$1', booking_id)
            if not hint:
                raise HTTPException(404, 'Booking not found.')
            locked_owner = hint['client_id'] if kind == 'refund' else (hint['photographer_id'] or hint['model_id'])
            await _lock_bank_owner(conn, locked_owner, allowed_deletion_statuses=('pending', 'blocked'))
            await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', f'financial:{actor}:{key}')
            existing = await conn.fetchrow('SELECT * FROM financial_operations WHERE actor_id=$1 AND idempotency_key=$2', actor, key)
            if existing:
                if existing['request_fingerprint'] != fingerprint:
                    raise HTTPException(409, 'Idempotency key has a different financial payload.')
                return public_operation(existing)
            booking, payment, earning = await _resources(conn, booking_id)
            creator = booking['photographer_id'] or booking['model_id']
            owner = booking['client_id'] if kind == 'refund' else creator
            if owner != locked_owner:
                raise HTTPException(409, 'Booking ownership changed; retry the reservation.')
            if actor != owner and not (kind == 'refund' and is_admin(settings, user)):
                raise HTTPException(403, 'This operation belongs to another booking participant.')
            if booking['status'] not in ('completed', 'cancelled'):
                raise HTTPException(409, 'Resolve the booking before refunding or paying out.')
            refund_reservation = await conn.fetchval("SELECT coalesce(sum(amount),0) FROM financial_operations WHERE booking_id=$1 AND kind='refund' AND status=ANY($2::text[])", booking_id, list(ACTIVE))
            payout_reservation = await conn.fetchval("SELECT coalesce(sum(amount),0) FROM financial_operations WHERE booking_id=$1 AND kind='payout' AND status=ANY($2::text[])", booking_id, list(ACTIVE))
            method_digest = None
            if kind == 'refund':
                if amount > zar(payment['amount']) - zar(payment['refunded_amount'], positive=False) - refund_reservation:
                    raise HTTPException(409, 'Refund exceeds the unrefunded payment balance.')
                if refund_reservation or payout_reservation or (earning and earning['paid_amount']):
                    raise HTTPException(409, 'Resolve outstanding refunds or creator payouts first.')
                if method_id:
                    _, method_digest = await _bank(conn, config, method_id, owner)
            else:
                profile = await conn.fetchrow('SELECT role,verified,kyc_status FROM profiles WHERE id=$1 FOR SHARE', owner)
                if not profile or profile['role'] not in ('photographer', 'model') or not profile['verified'] or profile['kyc_status'] != 'approved':
                    raise HTTPException(403, 'An approved creator identity is required.')
                if booking['status'] != 'completed' or not earning or earning['user_id'] != owner or zar(earning['amount']) != zar(booking['payout_amount']):
                    raise HTTPException(409, 'Completed creator earnings are required.')
                if refund_reservation:
                    raise HTTPException(409, 'Resolve the refund reservation first.')
                refunded = creator_share(booking, payment, zar(payment['refunded_amount'], positive=False))
                available = zar(earning['amount']) - refunded - zar(earning['paid_amount'], positive=False) - payout_reservation
                if amount > available:
                    raise HTTPException(409, 'Payout exceeds available creator earnings.')
                _, method_digest = await _bank(conn, config, method_id, owner)
                await conn.execute('UPDATE earnings SET refunded_amount=$2,updated_at=now() WHERE id=$1', earning['id'], refunded)
            operation = await conn.fetchrow('''INSERT INTO financial_operations
                (id,kind,actor_id,user_id,booking_id,payment_id,method_id,method_digest,amount,idempotency_key,request_fingerprint,reason,provider)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *''',
                str(uuid.uuid4()), kind, actor, owner, booking_id, payment['id'], method_id, method_digest, amount, key, fingerprint, reason,
                'payfast' if kind == 'refund' else 'stitch')
            return public_operation(operation)
    finally:
        await conn.close()


async def decide_operation(settings, admin, operation_id, decision, reference):
    require_admin(settings, admin)
    if decision not in ('approve', 'reject'):
        raise HTTPException(400, 'Invalid financial decision.')
    reference = text(reference, 'approval/delivery reference', 8, 255)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            hint = await conn.fetchrow('SELECT booking_id,user_id FROM financial_operations WHERE id=$1', operation_id)
            if not hint:
                raise HTTPException(404, 'Financial operation not found.')
            await _lock_bank_owner(conn, hint['user_id'], allowed_deletion_statuses=('pending', 'blocked'))
            await _resources(conn, hint['booking_id'])
            row = await conn.fetchrow('SELECT * FROM financial_operations WHERE id=$1 FOR UPDATE', operation_id)
            target = 'approved' if decision == 'approve' else 'rejected'
            if row['status'] == target:
                return public_operation(row)
            if row['status'] != 'pending_approval' and not (decision == 'reject' and row['status'] == 'approved' and row['attempt_count'] == 0):
                raise HTTPException(409, 'This financial operation has already been decided or submitted.')
            row = await conn.fetchrow('UPDATE financial_operations SET status=$2,approved_by=$3,approved_at=now(),approval_reference=$4,updated_at=now() WHERE id=$1 RETURNING *', operation_id, target, admin['id'], reference)
            return public_operation(row)
    finally:
        await conn.close()


class ProviderUnconfirmed(Exception):
    """Do not include gateway bodies, tokens, beneficiary details, or URLs in errors."""


def refund_statement(document):
    try:
        balance = cents_value(document['available_balance'])
        rows = []
        for row in document['transactions']:
            if row['type'] == 'Funds Received (Refund)':
                amount = Decimal(str(row['amount']))
                if amount >= 0 or amount != amount.to_integral_value():
                    raise ValueError
                rows.append({'amount': int(amount), 'date': text(row['date'], 'refund date', 1, 80), 'type': row['type']})
        if balance < 0:
            raise ValueError
        return {'available_balance': balance, 'refunds': rows}
    except (KeyError, TypeError, ValueError, InvalidOperation, HTTPException):
        raise ProviderUnconfirmed from None


def cents_value(value):
    if isinstance(value, bool):
        raise ProviderUnconfirmed
    amount = Decimal(str(value))
    if not amount.is_finite() or amount < 0 or amount != amount.to_integral_value():
        raise ProviderUnconfirmed
    return int(amount)


def prove_refund(baseline, current, amount):
    if not baseline:
        return None
    before = Counter(canonical(row) for row in baseline['refunds'])
    after = Counter(canonical(row) for row in current['refunds'])
    added = list((after - before).elements())
    cents = int(amount * 100)
    if before - after or len(added) != 1 or json.loads(added[0])['amount'] != -cents:
        return None
    if baseline['available_balance'] - current['available_balance'] != cents:
        return None
    return {'source': 'payfast_readback', 'amount': str(amount), 'currency': 'ZAR',
            'statement_entry_digest': hashlib.sha256(added[0]).hexdigest()}


class PayFastRefunds:
    def __init__(self, settings, client):
        self.settings, self.client = settings, client

    async def _request(self, method, path, body=None):
        headers = {'merchant-id': self.settings.payfast_merchant_id, 'version': 'v1', 'timestamp': datetime.now(UTC).isoformat(timespec='seconds')}
        fields = {**headers, **(body or {}), 'passphrase': self.settings.payfast_passphrase}
        headers['signature'] = hashlib.md5(urlencode(sorted(fields.items())).encode()).hexdigest()
        try:
            response = await self.client.request(method, f'https://api.payfast.co.za{path}',
                params={'testing': 'true'} if self.settings.payfast_sandbox else None,
                data=body, headers=headers)
            response.raise_for_status()
            data = response.json()
            if data.get('status') == 'success' and data.get('code') == 200:
                return data['data']['response']
            if method == 'GET' and 'amount_available_for_refund' in data:
                return data
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            pass
        raise ProviderUnconfirmed

    async def prepare(self, operation, payment, bank):
        identity = quote(payment['provider_payment_id'], safe='')
        query = await self._request('GET', f'/refunds/query/{identity}')
        history = refund_statement(await self._request('GET', f'/refunds/{identity}'))
        cents = int(operation['amount'] * 100)
        available = cents_value(query['amount_available_for_refund'])
        original = cents_value(query['amount_original'])
        if original != int(payment['amount'] * 100) or available != original - int(payment['refunded_amount'] * 100) or history['available_balance'] != available:
            raise ProviderUnconfirmed
        if -sum(row['amount'] for row in history['refunds']) != int(payment['refunded_amount'] * 100):
            raise ProviderUnconfirmed
        if query.get('status') != 'REFUNDABLE' or cents > available:
            raise ProviderUnconfirmed
        method = query['refund_full' if cents == available else 'refund_partial']['method']
        body = {'amount': str(cents), 'reason': operation['reason'], 'notify_buyer': '1', 'notify_merchant': '0'}
        if method == 'BANK_PAYOUT':
            if not bank or not bank['payfast_bank_name'] or bank['payfast_bank_name'] not in [row['bank_name'] for row in query['bank_names']]:
                raise ProviderUnconfirmed
            body.update(bank_account_holder=bank['account_holder'], bank_name=bank['payfast_bank_name'],
                bank_branch_code=bank['branch_code'], bank_account_number=bank['account_number'], bank_account_type=bank['account_type'])
        elif method != 'PAYMENT_SOURCE':
            raise ProviderUnconfirmed
        return history, body

    async def submit(self, operation, payment, body):
        # PayFast documents no client idempotency key for refunds. Never repeat POST.
        await self._request('POST', f"/refunds/{quote(payment['provider_payment_id'], safe='')}", body)

    async def lookup(self, payment):
        return refund_statement(await self._request('GET', f"/refunds/{quote(payment['provider_payment_id'], safe='')}"))


class StitchPayouts:
    def __init__(self, config, client):
        self.config, self.client, self.token = config, client, None

    async def _headers(self):
        if not self.token:
            try:
                response = await self.client.post('https://secure.stitch.money/connect/token', data={
                    'client_id': self.config.stitch_client_id, 'client_secret': self.config.stitch_client_secret,
                    'grant_type': 'client_credentials', 'audience': 'https://secure.stitch.money/connect/token', 'scope': 'client_disbursement'})
                response.raise_for_status()
                result = response.json()
                if 'client_disbursement' not in result.get('scope', '').split() or result.get('token_type', '').lower() != 'bearer':
                    raise ValueError
                self.token = result['access_token']
            except (httpx.HTTPError, ValueError, KeyError):
                raise ProviderUnconfirmed from None
        return {'Authorization': f'Bearer {self.token}'}

    async def submit(self, operation, bank):
        try:
            response = await self.client.post('https://api.stitch.money/v2/disbursements', headers=await self._headers(), json={
                'amount': {'currency': 'ZAR', 'quantity': str(operation['amount'])}, 'nonce': operation['id'],
                'externalReference': operation['id'], 'beneficiaryReference': 'PAPZII creator', 'type': 'default',
                'beneficiary': {'name': bank['account_holder'], 'accountNumber': bank['account_number'], 'bank': bank['bank_id']}})
            response.raise_for_status()
            return text(response.json()['id'], 'provider reference', 1, 1024)
        except (httpx.HTTPError, ValueError, KeyError, HTTPException):
            raise ProviderUnconfirmed from None

    async def lookup(self, provider_id):
        try:
            response = await self.client.get(f'https://api.stitch.money/v2/disbursements/{quote(provider_id, safe="")}', headers=await self._headers())
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise ProviderUnconfirmed from None

    async def lookup_nonce(self, nonce):
        # Official GraphQL nonce filter recovers an ID even if POST's reply was lost.
        query = 'query Recovery($nonce: String!) { client { disbursements(filter: {nonce: {eq: $nonce}}) { edges { node { id nonce } } } } }'
        try:
            response = await self.client.post('https://api.stitch.money/graphql', headers=await self._headers(), json={'query': query, 'variables': {'nonce': nonce}})
            response.raise_for_status()
            result = response.json()
            if result.get('errors'):
                raise ValueError
            edges = result['data']['client']['disbursements']['edges']
            if len(edges) != 1 or edges[0]['node']['nonce'] != nonce:
                raise ValueError
            return text(edges[0]['node']['id'], 'provider reference', 1, 1024)
        except (httpx.HTTPError, ValueError, KeyError, TypeError, HTTPException):
            raise ProviderUnconfirmed from None


def prove_payout(operation, bank, document, config):
    try:
        beneficiary = document['beneficiary']
        if document['nonce'] != operation['id'] or document['amount']['currency'] != 'ZAR' or zar(document['amount']['quantity']) != operation['amount']:
            raise ValueError
        destination = {'operation_id': operation['id'], 'user_id': operation['user_id'], 'account_number': beneficiary['accountNumber'],
                       'account_holder': beneficiary['name'], 'bank_id': beneficiary.get('bankId', beneficiary.get('bank'))}
        destination_digest = bank_digest(config, destination)
        if bank:
            if destination['account_number'] != bank['account_number'] or destination['account_holder'] != bank['account_holder'] or destination['bank_id'] != bank['bank_id']:
                raise ValueError
        else:
            prior = json.loads(operation['proof']) if isinstance(operation['proof'], str) else operation['proof']
            if operation['status'] != 'completed' or not prior or not hmac.compare_digest(prior.get('destination_digest', ''), destination_digest):
                raise ValueError
        reference = text(document['id'], 'provider reference', 1, 1024)
        if operation['provider_reference'] and reference != operation['provider_reference']:
            raise ValueError
        status = document['status']
        if status not in ('pending', 'submitted', 'completed', 'error', 'paused', 'cancelled', 'reversed'):
            raise ValueError
        return {'source': 'stitch_readback', 'provider_id': reference, 'nonce': operation['id'],
                'amount': str(operation['amount']), 'currency': 'ZAR', 'status': status, 'destination_digest': destination_digest}
    except (ValueError, KeyError, TypeError, HTTPException):
        raise ProviderUnconfirmed from None


async def _ledger(conn, operation, entry_type, amount, user_id=...):
    await conn.execute('''INSERT INTO financial_ledger (id,operation_id,booking_id,user_id,entry_type,amount)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (operation_id,entry_type) DO NOTHING''', str(uuid.uuid4()), operation['id'], operation['booking_id'], operation['user_id'] if user_id is ... else user_id, entry_type, amount)


async def _settle(conn, operation, booking, payment, earning, proof):
    prior = operation['status']
    if operation['kind'] == 'refund':
        if prior == 'completed':
            return prior
        amount = operation['amount']
        cumulative = payment['refunded_amount'] + amount
        if cumulative > payment['amount'] or (earning and earning['paid_amount']):
            raise HTTPException(409, 'Refund allocation requires reconciliation.')
        share = creator_share(booking, payment, cumulative) - creator_share(booking, payment, payment['refunded_amount'])
        await _ledger(conn, operation, 'customer_refund', -amount)
        await _ledger(conn, operation, 'creator_refund', -share, booking['photographer_id'] or booking['model_id'])
        await _ledger(conn, operation, 'platform_refund', -(amount - share), None)
        await conn.execute('UPDATE payments SET refunded_amount=$2,updated_at=now() WHERE id=$1', payment['id'], cumulative)
        if cumulative == payment['amount']:
            await conn.execute("UPDATE bookings SET payment_status='refunded',updated_at=now() WHERE id=$1", booking['id'])
        if earning:
            await conn.execute('UPDATE earnings SET refunded_amount=$2,updated_at=now() WHERE id=$1', earning['id'], creator_share(booking, payment, cumulative))
        return 'completed'
    status = proof['status']
    if prior in ('failed', 'rejected', 'reversed'):
        return prior
    if not earning:
        raise HTTPException(409, 'Creator earnings require reconciliation.')
    if status == 'completed':
        if prior != 'completed':
            if earning['paid_amount'] + operation['amount'] > earning['amount'] - earning['refunded_amount']:
                raise HTTPException(409, 'Creator balance requires reconciliation.')
            await _ledger(conn, operation, 'creator_payout', -operation['amount'])
            await conn.execute("UPDATE earnings SET paid_amount=paid_amount+$2,status=CASE WHEN paid_amount+$2=amount-refunded_amount THEN 'paid' ELSE 'partially_paid' END,updated_at=now() WHERE id=$1", earning['id'], operation['amount'])
        return 'completed'
    if status == 'reversed':
        if prior == 'completed':
            if earning['paid_amount'] < operation['amount']:
                raise HTTPException(409, 'Payout reversal requires reconciliation.')
            await _ledger(conn, operation, 'creator_payout_reversal', operation['amount'])
            await conn.execute("UPDATE earnings SET paid_amount=paid_amount-$2,status='pending',updated_at=now() WHERE id=$1", earning['id'], operation['amount'])
        return 'reversed'
    if prior == 'completed':
        return prior
    return {'pending': 'submitted', 'submitted': 'submitted', 'paused': 'paused', 'error': 'failed', 'cancelled': 'failed'}[status]


async def _unknown(settings, operation_id, conn=None):
    owned = conn is None
    conn = conn or await connect(settings)
    try:
        row = await conn.fetchrow("UPDATE financial_operations SET status='unknown',error_code='provider_unconfirmed',updated_at=now() WHERE id=$1 AND status IN ('executing','unknown','submitted','paused') RETURNING *", operation_id)
        if not row:
            row = await conn.fetchrow('SELECT * FROM financial_operations WHERE id=$1', operation_id)
        return public_operation(row)
    finally:
        if owned:
            await conn.close()


async def reconcile_operation(settings, config, admin, operation_id, *, client=None, provider_hint=None, receipt=None):
    if receipt is None:
        require_admin(settings, admin)
    if client is None:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as owned_client:
            return await reconcile_operation(settings, config, admin, operation_id, client=owned_client, provider_hint=provider_hint, receipt=receipt)
    conn = await connect(settings)
    try:
        hint = await conn.fetchrow('SELECT * FROM financial_operations WHERE id=$1', operation_id)
        if not hint:
            raise HTTPException(404, 'Financial operation not found.')
        if receipt:
            existing = await conn.fetchrow("SELECT * FROM financial_webhook_receipts WHERE provider='stitch' AND event_id=$1", receipt[0])
            if existing:
                if existing['payload_digest'] != receipt[1] or existing['operation_id'] != operation_id:
                    raise HTTPException(409, 'Webhook identity conflicts with a prior receipt.')
                return public_operation(hint)
        if hint['status'] not in RECONCILABLE:
            return public_operation(hint)
        provider, account, mode, _ = _identity(settings, config, hint['kind'])
        if hint['provider_account'] != account or hint['provider_mode'] != mode:
            raise HTTPException(409, 'Provider account or environment changed; reconciliation is required.')
        payment = await conn.fetchrow('SELECT * FROM payments WHERE id=$1', hint['payment_id'])
        try:
            if hint['kind'] == 'refund':
                document = await PayFastRefunds(settings, client).lookup(payment)
                baseline = json.loads(hint['baseline']) if isinstance(hint['baseline'], str) else hint['baseline']
                proof = prove_refund(baseline, document, hint['amount'])
                if not proof:
                    raise ProviderUnconfirmed
            else:
                gateway = StitchPayouts(config, client)
                reference = hint['provider_reference'] or provider_hint or await gateway.lookup_nonce(operation_id)
                bank_row = await conn.fetchrow('SELECT * FROM financial_bank_accounts WHERE method_id=$1', hint['method_id'])
                bank = decode_bank(config, bank_row) if bank_row else None
                proof = prove_payout(hint, bank, await gateway.lookup(reference), config)
                if proof['provider_id'] != reference:
                    raise ProviderUnconfirmed
                if receipt and receipt[2] in ('completed', 'reversed', 'error', 'cancelled') and proof['status'] != receipt[2]:
                    if not (receipt[2] == 'completed' and proof['status'] == 'reversed'):
                        raise ProviderUnconfirmed
        except (ProviderUnconfirmed, KeyError, TypeError, ValueError):
            if receipt:
                raise HTTPException(503, 'Disbursement read-back is not confirmed; retry the notification.') from None
            return await _unknown(settings, operation_id, conn)
        async with conn.transaction():
            await _lock_bank_owner(conn, hint['user_id'], allowed_deletion_statuses=('pending', 'blocked', 'processing', 'completed'))
            booking, payment, earning = await _resources(conn, hint['booking_id'])
            operation = await conn.fetchrow('SELECT * FROM financial_operations WHERE id=$1 FOR UPDATE', operation_id)
            if receipt:
                existing = await conn.fetchrow('SELECT * FROM financial_webhook_receipts WHERE provider=$1 AND event_id=$2', provider, receipt[0])
                if existing:
                    if existing['payload_digest'] != receipt[1] or existing['operation_id'] != operation_id:
                        raise HTTPException(409, 'Webhook identity conflicts with a prior receipt.')
                    return public_operation(operation)
            if operation['status'] not in RECONCILABLE:
                return public_operation(operation)
            status = await _settle(conn, operation, booking, payment, earning, proof)
            if operation['status'] == 'completed' and operation['kind'] == 'payout' and proof['status'] not in ('completed', 'reversed'):
                proof = operation['proof'] if isinstance(operation['proof'], dict) else json.loads(operation['proof'])
            row = await conn.fetchrow('''UPDATE financial_operations SET status=$2,proof=$3::jsonb,
                provider_reference=coalesce(provider_reference,$4),error_code=NULL,updated_at=now() WHERE id=$1 RETURNING *''',
                operation_id, status, json.dumps(proof), proof.get('provider_id'))
            if operation['kind'] == 'payout':
                await conn.execute('UPDATE payout_requests SET status=$2,payout_method_id=$3,updated_at=now() WHERE booking_id=$1', operation['booking_id'], status, operation['method_id'])
            if receipt:
                await conn.execute('INSERT INTO financial_webhook_receipts (provider,event_id,payload_digest,operation_id) VALUES ($1,$2,$3,$4)', provider, receipt[0], receipt[1], operation_id)
            return public_operation(row)
    finally:
        await conn.close()


async def execute_operation(settings, config, admin, operation_id, *, client=None):
    require_admin(settings, admin)
    if client is None:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as owned_client:
            return await execute_operation(settings, config, admin, operation_id, client=owned_client)
    conn = await connect(settings)
    try:
        async with conn.transaction():
            hint = await conn.fetchrow('SELECT booking_id,user_id FROM financial_operations WHERE id=$1', operation_id)
            if not hint:
                raise HTTPException(404, 'Financial operation not found.')
            await _lock_bank_owner(conn, hint['user_id'], allowed_deletion_statuses=('pending', 'blocked'))
            booking, payment, earning = await _resources(conn, hint['booking_id'])
            operation = await conn.fetchrow('SELECT * FROM financial_operations WHERE id=$1 FOR UPDATE', operation_id)
            if operation['attempt_count']:
                return public_operation(operation)
            if operation['status'] != 'approved':
                raise HTTPException(409, 'Administrator approval is required before execution.')
            if not await _ready(conn, settings, config, operation['kind']):
                raise HTTPException(503, 'Provider execution is disabled until configuration and independent acceptance evidence are present.')
            if operation['kind'] == 'refund' and (payment.get('merchant_id') != settings.payfast_merchant_id or payment.get('provider_mode') != ('sandbox' if settings.payfast_sandbox else 'live')):
                raise HTTPException(409, 'Original payment merchant binding requires reconciliation.')
            if operation['kind'] == 'payout':
                profile = await conn.fetchrow('SELECT role,verified,kyc_status FROM profiles WHERE id=$1 FOR SHARE', operation['user_id'])
                if not profile or profile['role'] not in ('photographer', 'model') or not profile['verified'] or profile['kyc_status'] != 'approved' or booking['status'] != 'completed':
                    raise HTTPException(409, 'The creator or booking is no longer payout eligible.')
            bank = None
            if operation['method_id']:
                bank, _ = await _bank(conn, config, operation['method_id'], operation['user_id'], operation['method_digest'])
            provider, account, mode, _ = _identity(settings, config, operation['kind'])
            operation = dict(await conn.fetchrow('''UPDATE financial_operations SET status='executing',attempt_count=1,
                attempted_at=now(),provider_account=$2,provider_mode=$3,updated_at=now() WHERE id=$1 RETURNING *''', operation_id, account, mode))
        # Commit the one-shot claim before any network I/O; a crash cannot resubmit.
        submission_started = False
        try:
            if operation['kind'] == 'refund':
                gateway = PayFastRefunds(settings, client)
                baseline, body = await gateway.prepare(operation, payment, bank)
                await conn.execute('UPDATE financial_operations SET baseline=$2::jsonb WHERE id=$1', operation_id, json.dumps(baseline))
                submission_started = True
                await gateway.submit(operation, payment, body)
            else:
                submission_started = True
                reference = await StitchPayouts(config, client).submit(operation, bank)
                await conn.execute('UPDATE financial_operations SET provider_reference=$2 WHERE id=$1', operation_id, reference)
        except (ProviderUnconfirmed, KeyError, TypeError, ValueError, InvalidOperation):
            if not submission_started:
                row = await conn.fetchrow("UPDATE financial_operations SET status='failed',error_code='provider_preflight_failed',updated_at=now() WHERE id=$1 AND status='executing' RETURNING *", operation_id)
                if row:
                    return public_operation(row)
            return await _unknown(settings, operation_id, conn)
    finally:
        await conn.close()
    return await reconcile_operation(settings, config, admin, operation_id, client=client)


def verify_stitch_webhook(config, raw, headers, *, now=None):
    if len(raw) > 65536:
        raise HTTPException(413, 'Financial webhook is too large.')
    try:
        event_id = text(headers.get('svix-id'), 'webhook id', 1, 200)
        stamp = headers['svix-timestamp']
        if abs((time.time() if now is None else now) - int(stamp)) > 300:
            raise ValueError
        if not config.stitch_webhook_secret.startswith('whsec_'):
            raise ValueError
        key = base64.b64decode(config.stitch_webhook_secret[6:], validate=True)
        if len(key) < 16:
            raise ValueError
        expected = base64.b64encode(hmac.new(key, f'{event_id}.{stamp}.'.encode() + raw, hashlib.sha256).digest()).decode()
        if not any(hmac.compare_digest(signature, f'v1,{expected}') for signature in headers['svix-signature'].split()):
            raise ValueError
        document = json.loads(raw)
        node = document['data']['client']['disbursements']['node']
        return event_id, hashlib.sha256(raw).hexdigest(), node
    except (KeyError, ValueError, TypeError, HTTPException):
        raise HTTPException(400, 'Invalid financial webhook.') from None


async def stitch_webhook(settings, config, raw, headers, *, client=None):
    event_id, digest, node = verify_stitch_webhook(config, raw, headers)
    operation_id = text(node.get('nonce'), 'disbursement nonce')
    reference = text(node.get('id'), 'disbursement id', 1, 1024)
    states = {'DisbursementSubmitted': 'submitted', 'DisbursementCompleted': 'completed', 'DisbursementError': 'error',
              'DisbursementPaused': 'paused', 'DisbursementCancelled': 'cancelled', 'DisbursementReversed': 'reversed'}
    status = states.get(node.get('status', {}).get('__typename'))
    if not status:
        raise HTTPException(400, 'Invalid disbursement notification status.')
    conn = await connect(settings)
    try:
        operation = await conn.fetchrow('SELECT * FROM financial_operations WHERE id=$1', operation_id)
        if not operation or operation['kind'] != 'payout' or not operation['attempt_count']:
            raise HTTPException(400, 'Unknown disbursement notification.')
        if node.get('amount', {}).get('currency') != 'ZAR' or zar(node.get('amount', {}).get('quantity')) != operation['amount']:
            raise HTTPException(400, 'Disbursement notification does not match the reservation.')
    finally:
        await conn.close()
    result = await reconcile_operation(settings, config, None, operation_id, client=client, provider_hint=reference, receipt=(event_id, digest, status))
    if result['status'] in ('unknown', 'executing'):
        raise HTTPException(503, 'Disbursement read-back is unavailable; retry the notification.')
    return {'received': True}


def create_financial_router(settings_dependency: Callable, user_dependency: Callable, config=None):
    """Both dependencies must use the parent's real settings and authenticated user."""
    router = APIRouter(prefix='/financial', tags=['financial'])
    config = config or FinancialConfig.from_env()

    @router.get('/capabilities')
    async def get_capabilities(settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await capabilities(settings, config)

    @router.post('/refunds')
    async def request_refund(payload: dict = Body(...), settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await request_operation(settings, config, user, 'refund', payload)

    @router.get('/operations/{operation_id}')
    async def get_status(operation_id: str, settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await get_operation(settings, user, operation_id)

    @router.post('/payouts')
    async def request_payout(payload: dict = Body(...), settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await request_operation(settings, config, user, 'payout', payload)

    @router.post('/bank-methods')
    async def add_method(payload: dict = Body(...), settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await add_bank_method(settings, config, user, payload)

    @router.get('/bank-methods')
    async def list_methods(settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return {'methods': await list_bank_methods(settings, user)}

    @router.post('/bank-methods/{method_id}/default')
    async def select_default(method_id: str, settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await set_default_bank_method(settings, config, user, method_id)

    @router.delete('/bank-methods/{method_id}')
    async def revoke_method(method_id: str, settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await revoke_bank_method(settings, user, method_id)

    @router.post('/bank-methods/{method_id}/verify')
    async def verify_method(method_id: str, payload: dict = Body(...), settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await verify_bank_method(settings, config, user, method_id, payload.get('evidence_reference'))

    @router.post('/bank-methods/{method_id}/reject')
    async def reject_method(method_id: str, payload: dict = Body(...), settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await reject_bank_method(settings, user, method_id, payload.get('reason'))

    @router.post('/operations/{operation_id}/decide')
    async def decide(operation_id: str, payload: dict = Body(...), settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await decide_operation(settings, user, operation_id, payload.get('decision'), payload.get('reference'))

    @router.post('/operations/{operation_id}/execute')
    async def execute(operation_id: str, settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await execute_operation(settings, config, user, operation_id)

    @router.post('/operations/{operation_id}/reconcile')
    async def reconcile(operation_id: str, settings=Depends(settings_dependency), user=Depends(user_dependency)):
        return await reconcile_operation(settings, config, user, operation_id)

    @router.post('/stitch/webhook')
    async def webhook(request: Request, settings=Depends(settings_dependency)):
        return await stitch_webhook(settings, config, await request.body(), request.headers)

    return router
