-- PAPZII Launch Readiness Audit v2 fixes (2026-03-26)

-- 1a. Turn on is_online for demo photographers (Durban rows only)
UPDATE photographers
SET is_online = true
WHERE id IN (
  SELECT ph.id
  FROM photographers ph
  JOIN profiles p ON p.id = ph.id
  WHERE p.full_name IN (
    'Michael Scott','Anna Gomez','Jason Lee',
    'Olivia Harris','Lerato Sithole'
  )
  AND ph.latitude BETWEEN -30.5 AND -29.0
);

-- 1b. Add realtime for location_tracks + photographers (idempotent)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE location_tracks;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'location_tracks already in supabase_realtime';
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE photographers;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'photographers already in supabase_realtime';
  END;
END $$;

-- 1c. Fix "Your bookings" status + price
UPDATE bookings
SET status = 'accepted', price_total = 3600
WHERE package_type = 'Your bookings'
  AND photographer_id = (
    SELECT ph.id
    FROM photographers ph
    JOIN profiles p ON p.id = ph.id
    WHERE p.full_name = 'Lerato Sithole'
    LIMIT 1
  );

-- 1d. Fix Half-day coverage price_total
UPDATE bookings
SET price_total = 3600
WHERE package_type = 'Half-day coverage'
  AND photographer_id IN (
    SELECT ph.id
    FROM photographers ph
    JOIN profiles p ON p.id = ph.id
    WHERE p.full_name = 'Sipho Dlamini'
    AND ph.latitude BETWEEN -30.5 AND -29.0
  );

-- 2a. Ensure Sipho Dlamini (Durban) is online
UPDATE photographers
SET is_online = true
WHERE id = (
  SELECT ph.id
  FROM photographers ph
  JOIN profiles p ON p.id = ph.id
  WHERE p.full_name = 'Sipho Dlamini'
  AND ph.latitude BETWEEN -30.5 AND -29.0
  LIMIT 1
);

-- 1e. Delete JHB Sipho Dlamini duplicate (safe only if no bookings)
DELETE FROM photographers
WHERE id = (
  SELECT ph.id
  FROM photographers ph
  JOIN profiles p ON p.id = ph.id
  WHERE p.full_name = 'Sipho Dlamini'
  AND ph.latitude < -30
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.photographer_id = photographers.id
);
