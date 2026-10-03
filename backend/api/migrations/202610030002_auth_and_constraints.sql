CREATE TABLE IF NOT EXISTS api_users (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    email_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS api_sessions (
    access_token text PRIMARY KEY,
    refresh_token text NOT NULL UNIQUE,
    user_id text NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    refresh_expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_sessions_user_id_idx ON api_sessions(user_id);
CREATE INDEX IF NOT EXISTS api_sessions_expires_at_idx ON api_sessions(expires_at);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS text text;
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS user_blocks_pair_idx ON user_blocks(blocker_id,blocked_id);
ALTER TABLE bookings ADD CONSTRAINT bookings_valid_period CHECK (end_datetime > start_datetime) NOT VALID;
ALTER TABLE bookings ADD CONSTRAINT bookings_one_provider CHECK ((photographer_id IS NULL) <> (model_id IS NULL)) NOT VALID;
ALTER TABLE bookings ADD CONSTRAINT bookings_nonnegative_quote CHECK (quote_amount >= 0 AND commission_amount >= 0 AND payout_amount >= 0) NOT VALID;
ALTER TABLE availability ADD CONSTRAINT availability_valid_day CHECK (day_of_week BETWEEN 0 AND 6) NOT VALID;
ALTER TABLE reviews ADD CONSTRAINT reviews_valid_rating CHECK (rating BETWEEN 1 AND 5) NOT VALID;
