-- =============================================================
-- Papzi Audit Migrations — run all at once in Supabase SQL Editor
-- =============================================================

-- ---------------------------------------------------------------
-- Fix #10: Convert profiles.contact_details to JSONB
--          (previously TEXT, TypeScript type expects JSON object)
-- ---------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS contact_details JSONB;

-- ---------------------------------------------------------------
-- Fix #11: Seed model row for Lerato Sithole
-- ---------------------------------------------------------------
INSERT INTO public.models (
  id, rating, location, latitude, longitude,
  price_range, style, bio, tags, portfolio_urls
)
SELECT
  p.id,
  5.0,
  COALESCE(p.city, 'Johannesburg'),
  -26.2041,
  28.0473,
  'R800–R2000',
  'Commercial',
  COALESCE(p.bio, 'Professional model based in Johannesburg.'),
  ARRAY['Commercial', 'Editorial'],
  ARRAY[]::text[]
FROM public.profiles p
WHERE p.full_name = 'Lerato Sithole'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------
-- Fix #13: recommend_posts — replace broken plpgsql with pure SQL
-- ---------------------------------------------------------------
DROP FUNCTION IF EXISTS recommend_posts(integer, integer, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION recommend_posts(
  limit_count    integer DEFAULT 20,
  offset_count   integer DEFAULT 0,
  recency_weight numeric DEFAULT 0.6,
  popularity_weight numeric DEFAULT 0.3,
  discussion_weight numeric DEFAULT 0.1
)
RETURNS SETOF posts AS $$
  SELECT p.*
  FROM posts p
  ORDER BY (
    (EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600) * -recency_weight +
    (p.likes_count  * popularity_weight) +
    (p.comment_count * discussion_weight)
  ) DESC
  LIMIT  limit_count
  OFFSET offset_count;
$$ LANGUAGE sql STABLE;


-- =============================================================
-- Booking pricing helper (optional, used by Papzi Uber pricing)
-- Stores base_amount + travel_amount if your trigger needs it
-- =============================================================
-- If your bookings table does not yet have these, run:
--   ALTER TABLE bookings ADD COLUMN IF NOT EXISTS base_amount    numeric(10,2);
--   ALTER TABLE bookings ADD COLUMN IF NOT EXISTS travel_amount  numeric(10,2);

/*
-- Trigger to auto-recalculate total/commission/payout whenever amounts change:
CREATE OR REPLACE FUNCTION recalculate_booking_amounts()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.base_amount IS NOT NULL THEN
    NEW.total_amount      := COALESCE(NEW.base_amount, 0) + COALESCE(NEW.travel_amount, 0);
    NEW.commission_amount := ROUND(NEW.total_amount * 0.30);
    NEW.payout_amount     := NEW.total_amount - NEW.commission_amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalculate_booking_amounts ON bookings;
CREATE TRIGGER trg_recalculate_booking_amounts
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION recalculate_booking_amounts();
*/
