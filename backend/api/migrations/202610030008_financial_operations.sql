-- No legacy pending row is treated as provider settlement or accepted credentials.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_mode text CHECK (provider_mode IN ('sandbox', 'live'));
ALTER TABLE earnings ADD COLUMN IF NOT EXISTS refunded_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0);
ALTER TABLE earnings ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0);

CREATE TABLE financial_bank_accounts (
    method_id text PRIMARY KEY REFERENCES payout_methods(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES api_users(id),
    encrypted_details bytea NOT NULL,
    details_digest text NOT NULL,
    verified_digest text,
    verification_reference text,
    verified_by text,
    verified_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((verified_at IS NULL AND verified_digest IS NULL) OR
           (verified_at IS NOT NULL AND verified_digest = details_digest AND verification_reference IS NOT NULL AND verified_by IS NOT NULL))
);

-- Deployment-owned evidence, never populated by mock tests or public routes.
-- Evidence must be independently reviewed for the exact merchant/client and mode.
CREATE TABLE financial_provider_acceptance (
    id text PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('payfast', 'stitch')),
    operation_kind text NOT NULL CHECK (operation_kind IN ('refund', 'payout')),
    provider_account text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('sandbox', 'live')),
    provider_transaction_id text NOT NULL,
    evidence_reference text NOT NULL,
    reviewed_by text NOT NULL,
    accepted_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (length(evidence_reference) >= 8 AND length(provider_transaction_id) > 0)
);

CREATE TABLE financial_operations (
    id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('refund', 'payout')),
    actor_id text NOT NULL REFERENCES api_users(id),
    user_id text NOT NULL REFERENCES api_users(id),
    booking_id text NOT NULL REFERENCES bookings(id),
    payment_id text NOT NULL REFERENCES payments(id),
    method_id text,
    method_digest text,
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    currency text NOT NULL DEFAULT 'ZAR' CHECK (currency = 'ZAR'),
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 120),
    request_fingerprint text NOT NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
        'pending_approval', 'approved', 'executing', 'unknown', 'submitted', 'paused',
        'completed', 'failed', 'rejected', 'reversed')),
    provider text NOT NULL CHECK (provider IN ('payfast', 'stitch')),
    provider_account text,
    provider_mode text CHECK (provider_mode IN ('sandbox', 'live')),
    provider_reference text,
    approved_by text,
    approved_at timestamptz,
    approval_reference text,
    attempted_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1),
    baseline jsonb,
    proof jsonb,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (actor_id, idempotency_key),
    UNIQUE (provider, provider_reference),
    CHECK (kind <> 'payout' OR (method_id IS NOT NULL AND method_digest IS NOT NULL)),
    CHECK (status <> 'completed' OR proof IS NOT NULL)
);
CREATE INDEX financial_operations_booking_idx ON financial_operations(booking_id, status);
CREATE INDEX financial_operations_reconcile_idx ON financial_operations(status, updated_at)
    WHERE status IN ('executing', 'unknown', 'submitted', 'paused');

CREATE TABLE financial_ledger (
    id text PRIMARY KEY,
    operation_id text NOT NULL REFERENCES financial_operations(id),
    booking_id text NOT NULL REFERENCES bookings(id),
    user_id text REFERENCES api_users(id),
    entry_type text NOT NULL CHECK (entry_type IN (
        'customer_refund', 'creator_refund', 'platform_refund', 'creator_payout', 'creator_payout_reversal')),
    amount numeric(14,2) NOT NULL,
    currency text NOT NULL DEFAULT 'ZAR' CHECK (currency = 'ZAR'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (operation_id, entry_type)
);

CREATE TABLE financial_webhook_receipts (
    provider text NOT NULL,
    event_id text NOT NULL,
    payload_digest text NOT NULL,
    operation_id text NOT NULL REFERENCES financial_operations(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, event_id)
);
REVOKE ALL ON financial_bank_accounts, financial_provider_acceptance,
    financial_operations, financial_ledger, financial_webhook_receipts FROM PUBLIC;
