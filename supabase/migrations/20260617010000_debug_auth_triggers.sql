-- Temporary diagnostics for auth create-user failures.
-- This is safe to keep in app_private/public only while we are debugging live drift.

CREATE OR REPLACE FUNCTION public.debug_auth_user_triggers()
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
  WHERE cn.nspname = 'auth'
    AND c.relname = 'users'
    AND NOT tg.tgisinternal
  ORDER BY tg.tgname;
$$;
