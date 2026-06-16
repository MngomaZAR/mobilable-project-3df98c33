-- Restore the availability state column used by dispatch, dashboards, and seeded auth flows.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS availability_status text;

UPDATE public.profiles
SET availability_status = COALESCE(
  availability_status,
  CASE
    WHEN role IN ('photographer', 'model') THEN 'offline'
    ELSE NULL
  END
);

CREATE INDEX IF NOT EXISTS idx_profiles_availability_status
  ON public.profiles (availability_status);
