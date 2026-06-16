-- Temporary diagnostics to inspect live booking trigger definitions and constraints.

CREATE OR REPLACE FUNCTION public.debug_booking_triggers()
RETURNS TABLE (
  trigger_name text,
  trigger_function text,
  trigger_schema text,
  definition text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    tg.tgname AS trigger_name,
    p.proname AS trigger_function,
    pn.nspname AS trigger_schema,
    pg_get_triggerdef(tg.oid) AS definition
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace cn ON cn.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = tg.tgfoid
  JOIN pg_namespace pn ON pn.oid = p.pronamespace
  WHERE cn.nspname = 'public'
    AND c.relname = 'bookings'
    AND NOT tg.tgisinternal
  ORDER BY tg.tgname;
$$;

CREATE OR REPLACE FUNCTION public.debug_notification_event_constraint()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT pg_get_constraintdef(c.oid)
  FROM pg_constraint c
  WHERE c.conname = 'notification_events_event_type_check'
    AND c.conrelid = 'public.notification_events'::regclass
  LIMIT 1;
$$;
