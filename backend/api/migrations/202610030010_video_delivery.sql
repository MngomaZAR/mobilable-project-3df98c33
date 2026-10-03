-- Booking coordination calls are not metered digital purchases or earnings.
CREATE TABLE IF NOT EXISTS booking_video_rooms (
    id text PRIMARY KEY,
    booking_id text NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
    room_name text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ending', 'ended')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    connected_at timestamptz,
    end_requested_at timestamptz,
    ended_at timestamptz,
    ended_by text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_video_rooms_expiry_idx ON booking_video_rooms (expires_at) WHERE status <> 'ended';

CREATE TABLE IF NOT EXISTS video_webhook_events (
    id text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_deliveries (
    id text PRIMARY KEY,
    job_id text NOT NULL REFERENCES job_outbox(id) ON DELETE CASCADE,
    token_id text NOT NULL REFERENCES push_tokens(id) ON DELETE CASCADE,
    notification_id text NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
    expo_push_token text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'ticket', 'checking', 'provider_accepted', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    receipt_attempts integer NOT NULL DEFAULT 0,
    ticket_id text UNIQUE,
    accepted_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, token_id)
);
CREATE INDEX IF NOT EXISTS push_deliveries_ready_idx ON push_deliveries (status, next_attempt_at);

-- These tables are service-owned; do not expose generic client CRUD.
REVOKE ALL ON booking_video_rooms, video_webhook_events, push_deliveries FROM PUBLIC;
