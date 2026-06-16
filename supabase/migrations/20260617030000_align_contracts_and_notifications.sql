-- Repair live drift surfaced by the full app sweep.

-- Contracts must accept the app's draft/signed/expired lifecycle.
ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_status_check;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('draft', 'signed', 'expired')) NOT VALID;

-- Notification events need to accept both event_type and type aliases.
ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS type text;

ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE OR REPLACE FUNCTION public.sync_notification_event_aliases()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.event_type := COALESCE(NEW.event_type, NEW.type);
  NEW.type := COALESCE(NEW.type, NEW.event_type);
  NEW.status := COALESCE(NEW.status, 'queued');
  NEW.attempts := COALESCE(NEW.attempts, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_notification_event_aliases ON public.notification_events;
CREATE TRIGGER trg_sync_notification_event_aliases
  BEFORE INSERT OR UPDATE ON public.notification_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_notification_event_aliases();
