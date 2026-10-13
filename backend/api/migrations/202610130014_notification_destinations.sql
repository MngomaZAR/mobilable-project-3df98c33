-- Preserve legacy notification content and read state while restoring navigation.
UPDATE notification_events
SET action_type = CASE
        WHEN nullif(action_payload->>'conversation_id', '') IS NOT NULL THEN 'chat'
        ELSE 'booking'
    END,
    category = CASE
        WHEN nullif(action_payload->>'conversation_id', '') IS NOT NULL THEN 'message'
        WHEN event_type LIKE 'payment_%' OR event_type LIKE 'payout_%' THEN 'earnings'
        ELSE 'booking'
    END
WHERE jsonb_typeof(action_payload) = 'object'
  AND (nullif(action_payload->>'conversation_id', '') IS NOT NULL
       OR nullif(action_payload->>'booking_id', '') IS NOT NULL)
  AND (action_type IS NULL OR action_type = ''
       OR (action_type IN ('booking', 'chat') AND category IS NULL));
