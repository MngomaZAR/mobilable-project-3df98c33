-- ============================================================
-- SAFE UPDATED_AT HELPER FOR MIXED TABLE SHAPES
-- ============================================================
--
-- Some compliance and audit tables are intentionally append-only and do not
-- expose an updated_at column. The shared trigger helper used across the
-- project must tolerate those tables so a harmless consent write does not
-- fail at runtime.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_jsonb(NEW) ? 'updated_at' THEN
    NEW.updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;
