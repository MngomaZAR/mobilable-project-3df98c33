-- Align notification event delivery statuses with live notification helpers.

ALTER TABLE public.notification_events
  DROP CONSTRAINT IF EXISTS notification_events_status_check;

ALTER TABLE public.notification_events
  ADD CONSTRAINT notification_events_status_check
  CHECK (status IN ('pending', 'queued', 'sent', 'failed')) NOT VALID;
