-- Temporary diagnostics for live booking notification function definitions.

CREATE OR REPLACE FUNCTION public.debug_booking_function_definitions()
RETURNS TABLE (
  function_name text,
  definition text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.proname AS function_name, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'notify_booking_event',
      'enqueue_booking_confirmed_event',
      'auto_award_hat',
      'auto_follow_on_booking',
      'auto_create_booking_contract',
      'auto_create_booking_conversation',
      'auto_create_media_delivery'
    )
  ORDER BY p.proname;
$$;
