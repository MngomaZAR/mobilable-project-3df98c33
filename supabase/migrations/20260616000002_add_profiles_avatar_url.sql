-- Keep profile rows compatible with the app's user model and seed data.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;
