-- Persist signup contact payload used by registration and profile hydration.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contact_details jsonb;
