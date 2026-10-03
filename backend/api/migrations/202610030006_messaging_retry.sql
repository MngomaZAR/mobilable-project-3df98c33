ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS request_fingerprint text;

-- Old messages remain unkeyed; new retry keys are scoped to the authenticated sender.
CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_client_message_idx
    ON messages (sender_id, client_message_id) WHERE client_message_id IS NOT NULL;

ALTER TABLE messages ADD CONSTRAINT messages_valid_retry_key CHECK (
    client_message_id IS NULL OR (
        sender_id IS NOT NULL AND conversation_id IS NOT NULL
        AND length(client_message_id) BETWEEN 1 AND 120
        AND client_message_id = btrim(client_message_id)
        AND request_fingerprint IS NOT NULL
        AND request_fingerprint ~ '^[0-9a-f]{64}$'
    )
);

ALTER TABLE stories ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'pending';
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'pending';
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS request_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS post_comments_user_idempotency_idx
    ON post_comments (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE post_comments ADD CONSTRAINT post_comments_valid_retry_key CHECK (
    idempotency_key IS NULL OR (
        user_id IS NOT NULL AND author_id IS NOT NULL AND author_id=user_id AND post_id IS NOT NULL
        AND length(idempotency_key) BETWEEN 1 AND 120
        AND idempotency_key = btrim(idempotency_key)
        AND request_fingerprint IS NOT NULL
        AND request_fingerprint ~ '^[0-9a-f]{64}$'
    )
);
