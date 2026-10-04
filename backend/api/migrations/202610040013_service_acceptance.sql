-- Reviewed native evidence is deployment-owned, never written by a mobile client.
ALTER TABLE booking_video_rooms ADD COLUMN source_revision text;
ALTER TABLE dispatch_requests ADD COLUMN source_revision text;
CREATE TABLE service_release_acceptance (
    id text PRIMARY KEY,
    capability text NOT NULL CHECK (capability IN ('video_call_service', 'instant_dispatch_service')),
    revision text NOT NULL CHECK (revision ~ '^[0-9a-f]{40}$'),
    endpoint text NOT NULL,
    proof jsonb NOT NULL,
    proof_sha256 text NOT NULL CHECK (proof_sha256 ~ '^[0-9a-f]{64}$'),
    reviewed_by text NOT NULL REFERENCES api_users(id),
    accepted_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > accepted_at AND expires_at <= accepted_at + interval '30 days')
);
REVOKE ALL ON service_release_acceptance FROM PUBLIC;
