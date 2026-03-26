-- Add test account flag to profiles (idempotent)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_test_account boolean DEFAULT false;
