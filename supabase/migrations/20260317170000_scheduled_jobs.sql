-- ============================================================
-- PAPZI SCHEDULED JOBS: DISPATCH EXPIRY + HEATMAP REFRESH
-- ============================================================

-- Ensure required extension exists (Supabase managed Postgres supports pg_cron).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Aggregate supply/demand into availability_heatmap_hourly.
CREATE OR REPLACE FUNCTION public.refresh_availability_heatmap_hourly(p_hours integer DEFAULT 6)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH online_supply AS (
    SELECT
      'combined'::text AS role,
      COALESCE(s.city, 'Unknown') AS city,
      date_trunc('hour', now()) AS bucket_start,
      format('%s:%s', round(COALESCE(s.latitude, 0)::numeric, 1), round(COALESCE(s.longitude, 0)::numeric, 1)) AS geohash,
      count(*)::integer AS online_count
    FROM (
      SELECT location AS city, latitude, longitude FROM public.photographers
      UNION ALL
      SELECT location AS city, latitude, longitude FROM public.models
    ) s
    WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    GROUP BY 1,2,3,4
  ),
  demand AS (
    SELECT
      'combined'::text AS role,
      COALESCE(pr.city, 'Unknown') AS city,
      date_trunc('hour', dr.created_at) AS bucket_start,
      format('%s:%s', round(COALESCE(dr.requested_lat, 0)::numeric, 1), round(COALESCE(dr.requested_lng, 0)::numeric, 1)) AS geohash,
      count(*)::integer AS demand_count
    FROM public.dispatch_requests dr
    LEFT JOIN public.profiles pr ON pr.id = dr.client_id
    WHERE dr.created_at >= now() - make_interval(hours => p_hours)
    GROUP BY 1,2,3,4
  ),
  merged AS (
    SELECT
      COALESCE(s.role, d.role) AS role,
      COALESCE(s.city, d.city) AS city,
      COALESCE(s.bucket_start, d.bucket_start) AS bucket_start,
      COALESCE(s.geohash, d.geohash) AS geohash,
      COALESCE(s.online_count, 0) AS online_count,
      COALESCE(d.demand_count, 0) AS demand_count,
      0::integer AS completed_count
    FROM online_supply s
    FULL OUTER JOIN demand d
      ON s.role = d.role
      AND s.city = d.city
      AND s.bucket_start = d.bucket_start
      AND s.geohash = d.geohash
  )
  INSERT INTO public.availability_heatmap_hourly(role, geohash, city, bucket_start, online_count, demand_count, completed_count)
  SELECT role, geohash, city, bucket_start, online_count, demand_count, completed_count
  FROM merged
  ON CONFLICT (role, geohash, bucket_start)
  DO UPDATE SET
    online_count = EXCLUDED.online_count,
    demand_count = EXCLUDED.demand_count,
    completed_count = EXCLUDED.completed_count,
    city = EXCLUDED.city,
    created_at = now();

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

-- Ensure dispatcher expiry function exists before scheduling.
CREATE OR REPLACE FUNCTION public.dispatch_expire_open_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.dispatch_offers
  SET status = 'expired', responded_at = now()
  WHERE status = 'offered'
    AND dispatch_request_id IN (
      SELECT id FROM public.dispatch_requests
      WHERE status IN ('queued','offered')
        AND expires_at IS NOT NULL
        AND expires_at <= now()
    );

  UPDATE public.dispatch_requests
  SET status = 'expired', updated_at = now()
  WHERE status IN ('queued','offered')
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Schedule jobs only if not already present.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'papzi_dispatch_expiry_job') THEN
    PERFORM cron.schedule('papzi_dispatch_expiry_job', '*/1 * * * *', $job$SELECT public.dispatch_expire_open_requests();$job$);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'papzi_heatmap_refresh_job') THEN
    PERFORM cron.schedule('papzi_heatmap_refresh_job', '*/5 * * * *', $job$SELECT public.refresh_availability_heatmap_hourly(6);$job$);
  END IF;
END;
$$;
