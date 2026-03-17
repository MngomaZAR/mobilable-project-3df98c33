-- ============================================================
-- PAPZI WAVE 1-6 FOUNDATION: DISPATCH, ETA, STATUS, COMPLIANCE
-- ============================================================

-- ---------- Shared trigger helper ----------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------- Dispatch core ----------
CREATE TABLE IF NOT EXISTS public.dispatch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_type text NOT NULL DEFAULT 'photography' CHECK (service_type IN ('photography','modeling','combined','video_call')),
  fanout_count integer NOT NULL DEFAULT 1 CHECK (fanout_count BETWEEN 1 AND 5),
  intensity_level integer NOT NULL DEFAULT 1 CHECK (intensity_level BETWEEN 1 AND 5),
  sla_timeout_seconds integer NOT NULL DEFAULT 90 CHECK (sla_timeout_seconds BETWEEN 15 AND 900),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','offered','accepted','expired','cancelled')),
  assignment_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  quote_token text UNIQUE,
  requested_lat numeric(10,7),
  requested_lng numeric(10,7),
  price_base numeric(10,2),
  price_multiplier numeric(8,4) DEFAULT 1,
  price_estimate numeric(10,2),
  expires_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dispatch_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_request_id uuid NOT NULL REFERENCES public.dispatch_requests(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  offer_rank integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','declined','expired','cancelled')),
  idempotency_key text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dispatch_request_id, provider_id)
);

CREATE TABLE IF NOT EXISTS public.dispatch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_request_id uuid NOT NULL REFERENCES public.dispatch_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_requests_client_status ON public.dispatch_requests(client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_requests_booking ON public.dispatch_requests(booking_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_request_status ON public.dispatch_offers(dispatch_request_id, status, offer_rank);
CREATE INDEX IF NOT EXISTS idx_dispatch_events_request_created ON public.dispatch_events(dispatch_request_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_dispatch_requests_updated_at ON public.dispatch_requests;
CREATE TRIGGER trg_dispatch_requests_updated_at
BEFORE UPDATE ON public.dispatch_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- ETA + movement ----------
CREATE TABLE IF NOT EXISTS public.location_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('client','provider')),
  latitude numeric(10,7) NOT NULL,
  longitude numeric(10,7) NOT NULL,
  accuracy_m numeric(8,2),
  source text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.eta_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  dispatch_request_id uuid REFERENCES public.dispatch_requests(id) ON DELETE SET NULL,
  eta_seconds integer NOT NULL CHECK (eta_seconds >= 0),
  eta_confidence numeric(4,3) NOT NULL DEFAULT 0.70 CHECK (eta_confidence >= 0 AND eta_confidence <= 1),
  distance_km numeric(8,3),
  route_polyline jsonb,
  source text NOT NULL DEFAULT 'routing_service',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_location_tracks_booking_created ON public.location_tracks(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eta_snapshots_booking_created ON public.eta_snapshots(booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.availability_heatmap_hourly (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('photographer','model','combined')),
  geohash text NOT NULL,
  city text,
  bucket_start timestamptz NOT NULL,
  online_count integer NOT NULL DEFAULT 0,
  demand_count integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role, geohash, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_heatmap_bucket_role ON public.availability_heatmap_hourly(bucket_start DESC, role);

-- ---------- Status + trends ----------
CREATE TABLE IF NOT EXISTS public.status_scores (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  seen_score integer NOT NULL DEFAULT 0,
  scene_rank integer NOT NULL DEFAULT 0,
  trending_badges jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trend_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  leaderboard jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trend_windows_city_active ON public.trend_windows(city, starts_at DESC, ends_at DESC);

-- ---------- Compliance + moderation ----------
CREATE TABLE IF NOT EXISTS public.consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  consent_type text NOT NULL,
  legal_basis text NOT NULL DEFAULT 'consent',
  consent_version text,
  enabled boolean NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_events_user_type ON public.consent_events(user_id, consent_type, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  consent_type text NOT NULL,
  granted boolean NOT NULL,
  accepted boolean,
  granted_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  legal_basis text NOT NULL DEFAULT 'consent',
  version text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, consent_type)
);

ALTER TABLE public.user_consents ADD COLUMN IF NOT EXISTS granted boolean DEFAULT true;
ALTER TABLE public.user_consents ADD COLUMN IF NOT EXISTS accepted boolean DEFAULT true;
ALTER TABLE public.user_consents ADD COLUMN IF NOT EXISTS granted_at timestamptz DEFAULT now();
ALTER TABLE public.user_consents ADD COLUMN IF NOT EXISTS accepted_at timestamptz DEFAULT now();

DROP TRIGGER IF EXISTS trg_user_consents_updated_at ON public.user_consents;
CREATE TRIGGER trg_user_consents_updated_at
BEFORE UPDATE ON public.user_consents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.moderation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('post','message','profile','booking','payment','other')),
  target_id text,
  reason text NOT NULL,
  severity smallint NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','escalated','resolved','rejected')),
  sla_due_at timestamptz,
  assigned_admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_moderation_cases_updated_at ON public.moderation_cases;
CREATE TRIGGER trg_moderation_cases_updated_at
BEFORE UPDATE ON public.moderation_cases
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.policy_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id text,
  policy_code text NOT NULL,
  severity smallint NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'warning' CHECK (status IN ('warning','blocked','removed','resolved')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Pricing + experiments ----------
CREATE TABLE IF NOT EXISTS public.pricing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_code text NOT NULL,
  service_type text NOT NULL DEFAULT 'photography',
  min_multiplier numeric(8,4) NOT NULL DEFAULT 1,
  max_multiplier numeric(8,4) NOT NULL DEFAULT 2,
  base_multiplier numeric(8,4) NOT NULL DEFAULT 1,
  surge_threshold integer NOT NULL DEFAULT 3,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_pricing_policies_updated_at ON public.pricing_policies;
CREATE TRIGGER trg_pricing_policies_updated_at
BEFORE UPDATE ON public.pricing_policies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.pricing_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  dispatch_request_id uuid REFERENCES public.dispatch_requests(id) ON DELETE SET NULL,
  quote_token text NOT NULL UNIQUE,
  fanout_count integer NOT NULL DEFAULT 1,
  intensity_level integer NOT NULL DEFAULT 1,
  base_amount numeric(10,2) NOT NULL DEFAULT 0,
  surge_multiplier numeric(8,4) NOT NULL DEFAULT 1,
  intensity_multiplier numeric(8,4) NOT NULL DEFAULT 1,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','accepted','expired','cancelled')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_quotes_client_created ON public.pricing_quotes(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.experiment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  experiment_key text NOT NULL,
  variant_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, experiment_key)
);

-- ---------- Booking contract extensions ----------
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS fanout_count integer DEFAULT 1;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS intensity_level integer DEFAULT 1;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS quote_token text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS assignment_state text DEFAULT 'queued' CHECK (assignment_state IN ('queued','offered','accepted','expired','cancelled'));
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS eta_confidence numeric(4,3);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS dispatch_request_id uuid REFERENCES public.dispatch_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_dispatch_request ON public.bookings(dispatch_request_id);

-- ---------- RPC: deterministic accept + idempotency ----------
CREATE OR REPLACE FUNCTION public.dispatch_accept_offer(
  p_dispatch_request_id uuid,
  p_offer_id uuid,
  p_provider_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS public.dispatch_offers
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request public.dispatch_requests;
  v_existing public.dispatch_offers;
  v_offer public.dispatch_offers;
BEGIN
  SELECT * INTO v_request
  FROM public.dispatch_requests
  WHERE id = p_dispatch_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch request not found';
  END IF;

  IF v_request.status = 'accepted' AND v_request.assignment_profile_id = p_provider_id THEN
    SELECT * INTO v_existing
    FROM public.dispatch_offers
    WHERE dispatch_request_id = p_dispatch_request_id
      AND provider_id = p_provider_id
      AND status = 'accepted'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  IF v_request.status IN ('expired','cancelled') THEN
    RAISE EXCEPTION 'Dispatch request is not active';
  END IF;

  UPDATE public.dispatch_offers
  SET status = CASE WHEN id = p_offer_id THEN 'accepted' ELSE 'cancelled' END,
      responded_at = now(),
      idempotency_key = COALESCE(p_idempotency_key, idempotency_key)
  WHERE dispatch_request_id = p_dispatch_request_id
    AND status IN ('offered','accepted');

  UPDATE public.dispatch_requests
  SET status = 'accepted',
      assignment_profile_id = p_provider_id,
      accepted_at = now(),
      updated_at = now()
  WHERE id = p_dispatch_request_id;

  UPDATE public.bookings
  SET assignment_state = 'accepted',
      dispatch_request_id = p_dispatch_request_id
  WHERE id = v_request.booking_id;

  INSERT INTO public.dispatch_events(dispatch_request_id, event_type, actor_id, payload)
  VALUES (p_dispatch_request_id, 'offer_accepted', p_provider_id, jsonb_build_object('offer_id', p_offer_id));

  SELECT * INTO v_offer FROM public.dispatch_offers WHERE id = p_offer_id;
  RETURN v_offer;
END;
$$;

-- ---------- RPC: expire open requests ----------
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

-- ---------- RLS ----------
ALTER TABLE public.dispatch_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eta_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_heatmap_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trend_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dispatch own requests" ON public.dispatch_requests;
CREATE POLICY "dispatch own requests" ON public.dispatch_requests
FOR ALL USING (auth.uid() = client_id OR auth.uid() = assignment_profile_id)
WITH CHECK (auth.uid() = client_id);

DROP POLICY IF EXISTS "dispatch offer visibility" ON public.dispatch_offers;
CREATE POLICY "dispatch offer visibility" ON public.dispatch_offers
FOR SELECT USING (
  auth.uid() = provider_id OR
  EXISTS (
    SELECT 1 FROM public.dispatch_requests dr
    WHERE dr.id = dispatch_request_id AND dr.client_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "dispatch offer update by provider" ON public.dispatch_offers;
CREATE POLICY "dispatch offer update by provider" ON public.dispatch_offers
FOR UPDATE USING (auth.uid() = provider_id)
WITH CHECK (auth.uid() = provider_id);

DROP POLICY IF EXISTS "dispatch events visibility" ON public.dispatch_events;
CREATE POLICY "dispatch events visibility" ON public.dispatch_events
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.dispatch_requests dr
    WHERE dr.id = dispatch_request_id
      AND (dr.client_id = auth.uid() OR dr.assignment_profile_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "location tracks participants" ON public.location_tracks;
CREATE POLICY "location tracks participants" ON public.location_tracks
FOR ALL USING (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = booking_id
      AND (b.client_id = auth.uid() OR b.photographer_id = auth.uid() OR b.model_id = auth.uid())
  )
)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "eta snapshots participants" ON public.eta_snapshots;
CREATE POLICY "eta snapshots participants" ON public.eta_snapshots
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = booking_id
      AND (b.client_id = auth.uid() OR b.photographer_id = auth.uid() OR b.model_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "heatmap read all" ON public.availability_heatmap_hourly;
CREATE POLICY "heatmap read all" ON public.availability_heatmap_hourly
FOR SELECT USING (true);

DROP POLICY IF EXISTS "status scores read all" ON public.status_scores;
CREATE POLICY "status scores read all" ON public.status_scores
FOR SELECT USING (true);

DROP POLICY IF EXISTS "status scores own write" ON public.status_scores;
CREATE POLICY "status scores own write" ON public.status_scores
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "trend windows read all" ON public.trend_windows;
CREATE POLICY "trend windows read all" ON public.trend_windows
FOR SELECT USING (true);

DROP POLICY IF EXISTS "consent events own" ON public.consent_events;
CREATE POLICY "consent events own" ON public.consent_events
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user consents own" ON public.user_consents;
CREATE POLICY "user consents own" ON public.user_consents
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "moderation reporter insert" ON public.moderation_cases;
CREATE POLICY "moderation reporter insert" ON public.moderation_cases
FOR INSERT WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "moderation own visibility" ON public.moderation_cases;
CREATE POLICY "moderation own visibility" ON public.moderation_cases
FOR SELECT USING (auth.uid() = reporter_id OR auth.uid() = target_user_id OR auth.uid() = assigned_admin_id);

DROP POLICY IF EXISTS "policy violations own read" ON public.policy_violations;
CREATE POLICY "policy violations own read" ON public.policy_violations
FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "pricing policies read all" ON public.pricing_policies;
CREATE POLICY "pricing policies read all" ON public.pricing_policies
FOR SELECT USING (true);

DROP POLICY IF EXISTS "pricing quotes own" ON public.pricing_quotes;
CREATE POLICY "pricing quotes own" ON public.pricing_quotes
FOR ALL USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = client_id);

DROP POLICY IF EXISTS "experiment own" ON public.experiment_assignments;
CREATE POLICY "experiment own" ON public.experiment_assignments
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ---------- Seed default pricing policy ----------
INSERT INTO public.pricing_policies(region_code, service_type, min_multiplier, max_multiplier, base_multiplier, surge_threshold, active)
SELECT 'ZA-WC', 'photography', 1.0, 2.5, 1.0, 3, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.pricing_policies WHERE region_code = 'ZA-WC' AND service_type = 'photography'
);
