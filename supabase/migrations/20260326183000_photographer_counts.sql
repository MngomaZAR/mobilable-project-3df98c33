-- Add denormalized counts for reference parity (idempotent)
ALTER TABLE public.photographers
  ADD COLUMN IF NOT EXISTS review_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bookings integer DEFAULT 0;
