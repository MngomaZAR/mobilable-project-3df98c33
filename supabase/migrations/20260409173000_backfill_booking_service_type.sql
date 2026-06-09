ALTER TABLE public.bookings
ALTER COLUMN service_type SET DEFAULT 'photography';

UPDATE public.bookings
SET service_type = CASE
  WHEN model_id IS NOT NULL THEN 'modeling'
  WHEN photographer_id IS NOT NULL THEN 'photography'
  ELSE 'photography'
END
WHERE service_type IS NULL;

ALTER TABLE public.bookings
ALTER COLUMN service_type SET NOT NULL;
