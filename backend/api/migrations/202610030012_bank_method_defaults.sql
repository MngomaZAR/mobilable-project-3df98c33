ALTER TABLE payout_methods ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS payout_methods_user_idx ON payout_methods(user_id);

-- Private, independently reviewed decisions; never returned by the bank-method API.
ALTER TABLE financial_bank_accounts ADD COLUMN IF NOT EXISTS review_decision text CHECK (review_decision IN ('verified', 'rejected'));
ALTER TABLE financial_bank_accounts ADD COLUMN IF NOT EXISTS review_reference text;
ALTER TABLE financial_bank_accounts ADD COLUMN IF NOT EXISTS reviewed_by text REFERENCES api_users(id);
ALTER TABLE financial_bank_accounts ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE financial_bank_accounts ADD CONSTRAINT financial_bank_review_complete CHECK (
    (review_decision IS NULL AND review_reference IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (review_decision IS NOT NULL AND review_reference IS NOT NULL AND length(review_reference) >= 8
        AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
);
