CREATE TABLE IF NOT EXISTS content_moderation_events (
    id text PRIMARY KEY,
    admin_user_id text NOT NULL,
    content_table text NOT NULL CHECK (content_table IN ('posts','stories','post_comments','reviews')),
    content_id text NOT NULL,
    previous_status text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('approved','rejected')),
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
    parent_event_id text REFERENCES content_moderation_events(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_moderation_events_target_idx
    ON content_moderation_events(content_table,content_id,created_at);

-- Domain commands append events; the generic data API does not expose this table.
CREATE OR REPLACE FUNCTION preserve_content_moderation_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Content moderation events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS content_moderation_events_append_only ON content_moderation_events;
CREATE TRIGGER content_moderation_events_append_only
    BEFORE UPDATE OR DELETE ON content_moderation_events
    FOR EACH ROW EXECUTE FUNCTION preserve_content_moderation_event();

CREATE INDEX IF NOT EXISTS posts_pending_moderation_idx ON posts(created_at,id)
    WHERE coalesce(moderation_status,'pending')='pending';
CREATE INDEX IF NOT EXISTS stories_pending_moderation_idx ON stories(created_at,id)
    WHERE coalesce(moderation_status,'pending')='pending';
CREATE INDEX IF NOT EXISTS comments_pending_moderation_idx ON post_comments(created_at,id)
    WHERE coalesce(moderation_status,'pending')='pending';
CREATE INDEX IF NOT EXISTS reviews_pending_moderation_idx ON reviews(created_at,id)
    WHERE coalesce(moderation_status,'pending')='pending';
