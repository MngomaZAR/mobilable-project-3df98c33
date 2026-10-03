UPDATE api_sessions SET access_token=encode(digest(access_token,'sha256'),'hex'),
    refresh_token=encode(digest(refresh_token,'sha256'),'hex');
ALTER TABLE api_sessions ADD COLUMN IF NOT EXISTS id text NOT NULL DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX IF NOT EXISTS api_sessions_id_idx ON api_sessions(id);
ALTER TABLE api_sessions ADD CONSTRAINT api_sessions_token_fingerprints
    CHECK (access_token ~ '^[0-9a-f]{64}$' AND refresh_token ~ '^[0-9a-f]{64}$');
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key_hash text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_expiry_idx ON auth_rate_limits(expires_at);
CREATE TABLE IF NOT EXISTS password_resets (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
    used_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);
