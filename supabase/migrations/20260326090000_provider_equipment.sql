ALTER TABLE public.photographers
  ADD COLUMN IF NOT EXISTS tier_id text,
  ADD COLUMN IF NOT EXISTS equipment jsonb;

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS tier_id text,
  ADD COLUMN IF NOT EXISTS equipment jsonb;
