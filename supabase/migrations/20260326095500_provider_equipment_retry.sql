alter table if exists public.photographers
  add column if not exists tier_id text,
  add column if not exists equipment jsonb;

alter table if exists public.models
  add column if not exists tier_id text,
  add column if not exists equipment jsonb;
