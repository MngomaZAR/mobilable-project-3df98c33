ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deletion_status text;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS receipt_hash text;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS blocked_reason text;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS legal_hold_until timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_receipt_idx
    ON account_deletion_requests(receipt_hash) WHERE receipt_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_deletion_actor_status_idx
    ON account_deletion_requests(created_by,status);
