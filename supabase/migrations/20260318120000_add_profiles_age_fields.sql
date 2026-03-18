ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS date_of_birth date;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS age_verified boolean DEFAULT false;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS age_verified_at timestamptz;

UPDATE public.profiles
SET age_verified = COALESCE(age_verified, false)
WHERE age_verified IS NULL;

