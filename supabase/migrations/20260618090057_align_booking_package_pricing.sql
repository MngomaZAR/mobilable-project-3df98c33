-- Align booking pricing with app package identifiers.
-- The mobile app sends package_id values such as instant/starter/standard/full/premium.
-- Older DB pricing logic used legacy paparazzi/event fields and could undercharge or reject inserts.

CREATE OR REPLACE FUNCTION public.calculate_booking_pricing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  p_commission_rate numeric := 0.30;
  base_price numeric := 0;
  distance_fee numeric := 0;
BEGIN
  NEW.pricing_mode := COALESCE(NEW.pricing_mode, 'flat');
  NEW.currency := COALESCE(NEW.currency, 'ZAR');
  NEW.distance_km := COALESCE(NEW.distance_km, 0);

  base_price := CASE COALESCE(NEW.package_id, NEW.package_type, NEW.event_package_id, '')
    WHEN 'instant' THEN 1500
    WHEN 'starter' THEN 2200
    WHEN 'standard' THEN 3600
    WHEN 'full' THEN 6000
    WHEN 'premium' THEN 9000
    WHEN 'essential' THEN 1400
    WHEN 'professional' THEN 3400
    WHEN 'studio' THEN 8200
    WHEN 'wedding' THEN 9000
    WHEN 'corporate' THEN 6000
    WHEN 'birthday' THEN 2500
    ELSE COALESCE(NULLIF(NEW.price_total, 0), 1200)
  END;

  distance_fee := 0.75 * GREATEST(0, NEW.distance_km);
  NEW.price_total := ROUND((base_price + distance_fee) * 100) / 100;
  NEW.commission_rate := p_commission_rate;
  NEW.commission_amount := ROUND(NEW.price_total * p_commission_rate * 100) / 100;
  NEW.photographer_payout := ROUND((NEW.price_total - NEW.commission_amount) * 100) / 100;

  -- Some deployments have total_amount as a generated column, so do not assign it here.
  NEW.payout_amount := NEW.photographer_payout;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_calculate_booking_pricing ON public.bookings;
CREATE TRIGGER tr_calculate_booking_pricing
BEFORE INSERT OR UPDATE OF price_total, package_id, package_type, event_package_id, distance_km, photographer_id
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.calculate_booking_pricing();
