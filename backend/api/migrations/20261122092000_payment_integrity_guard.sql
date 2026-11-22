-- Do not allow a new payment to become completed without a provider receipt.
-- Existing legacy rows are intentionally left untouched for manual reconciliation.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'payments'::regclass
          AND conname = 'payments_completed_requires_provider_id'
    ) THEN
        ALTER TABLE payments
            ADD CONSTRAINT payments_completed_requires_provider_id
            CHECK (
                status NOT IN ('completed', 'paid')
                OR NULLIF(TRIM(provider_payment_id), '') IS NOT NULL
            ) NOT VALID;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS payments_unverified_completed_idx
    ON payments (status, updated_at)
    WHERE status IN ('completed', 'paid')
      AND NULLIF(TRIM(provider_payment_id), '') IS NULL;
