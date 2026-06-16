-- Expand notification event types to match the live booking helper functions.

ALTER TABLE public.notification_events
  DROP CONSTRAINT IF EXISTS notification_events_event_type_check;

ALTER TABLE public.notification_events
  ADD CONSTRAINT notification_events_event_type_check
  CHECK (
    event_type IN (
      'booking_confirmed',
      'booking_request',
      'booking_accepted',
      'booking_completed',
      'booking_declined',
      'booking_cancelled',
      'photographer_dispatched',
      'upload_reminder',
      'new_follow',
      'new_message'
    )
  ) NOT VALID;
