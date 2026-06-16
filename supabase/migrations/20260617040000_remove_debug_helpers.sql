-- Remove temporary debug helpers used during release triage.

DROP FUNCTION IF EXISTS public.debug_auth_user_triggers();
DROP FUNCTION IF EXISTS public.debug_booking_triggers();
DROP FUNCTION IF EXISTS public.debug_notification_event_constraint();
DROP FUNCTION IF EXISTS public.debug_booking_function_definitions();
