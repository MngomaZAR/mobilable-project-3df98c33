ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS kyc_status text
CHECK (kyc_status IN ('pending', 'approved', 'rejected'));

UPDATE public.profiles
SET kyc_status = CASE
  WHEN verified IS TRUE THEN 'approved'
  WHEN kyc_status IS NULL THEN 'pending'
  ELSE kyc_status
END
WHERE kyc_status IS NULL OR verified IS TRUE;

ALTER TABLE public.profiles
ALTER COLUMN kyc_status SET DEFAULT 'pending';

