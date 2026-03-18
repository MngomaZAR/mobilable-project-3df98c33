-- ============================================================
-- PAPZI ENFORCEMENT: SUBSCRIPTIONS, VIDEO BILLING, RECOMMENDATIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ------------------------------------------------------------
-- Subscription expiry enforcement + entitlement helpers
-- ------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_renewal_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_error text;

CREATE INDEX IF NOT EXISTS idx_subscriptions_active_period
  ON public.subscriptions (subscriber_id, creator_id, status, current_period_end);

CREATE OR REPLACE FUNCTION public.enforce_subscription_expiry()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.subscriptions
  SET
    status = 'expired',
    expired_at = COALESCE(expired_at, now()),
    updated_at = now()
  WHERE status = 'active'
    AND current_period_end IS NOT NULL
    AND current_period_end <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_active_subscription(
  p_subscriber_id uuid,
  p_creator_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.subscriber_id = p_subscriber_id
      AND s.creator_id = p_creator_id
      AND s.status = 'active'
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_post(
  p_user_id uuid,
  p_post_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_author_id uuid;
  v_is_locked boolean := false;
  v_subscribers_only boolean := false;
BEGIN
  SELECT p.author_id, COALESCE(p.is_locked, false), COALESCE(p.subscribers_only, false)
  INTO v_author_id, v_is_locked, v_subscribers_only
  FROM public.posts p
  WHERE p.id = p_post_id;

  IF v_author_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_user_id = v_author_id THEN
    RETURN true;
  END IF;

  IF NOT v_is_locked AND NOT v_subscribers_only THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.post_unlocks u
    WHERE u.user_id = p_user_id
      AND u.post_id = p_post_id
  ) THEN
    RETURN true;
  END IF;

  IF v_subscribers_only OR v_is_locked THEN
    RETURN public.has_active_subscription(p_user_id, v_author_id);
  END IF;

  RETURN false;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'papzi_subscription_expiry_job') THEN
    PERFORM cron.schedule(
      'papzi_subscription_expiry_job',
      '*/30 * * * *',
      $job$SELECT public.enforce_subscription_expiry();$job$
    );
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- Credits policy helper for server-side billing enforcement
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credits_adjust_for_user(
  p_user_id uuid,
  p_amount integer,
  p_reason text DEFAULT null,
  p_ref_type text DEFAULT null,
  p_ref_id uuid DEFAULT null
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance integer;
  v_new_balance integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  IF p_amount = 0 THEN
    SELECT balance INTO v_balance FROM public.credits_wallets WHERE user_id = p_user_id;
    RETURN COALESCE(v_balance, 0);
  END IF;

  INSERT INTO public.credits_wallets(user_id, balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO v_balance
  FROM public.credits_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF p_amount < 0 AND v_balance < abs(p_amount) THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  v_new_balance := v_balance + p_amount;

  UPDATE public.credits_wallets
  SET balance = v_new_balance,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credits_ledger(user_id, amount, direction, reason, ref_type, ref_id)
  VALUES (
    p_user_id,
    abs(p_amount),
    CASE WHEN p_amount > 0 THEN 'credit' ELSE 'debit' END,
    COALESCE(p_reason, 'system_adjustment'),
    p_ref_type,
    p_ref_id
  );

  RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.credits_adjust_for_user(uuid, integer, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credits_adjust_for_user(uuid, integer, text, text, uuid) TO service_role;

-- ------------------------------------------------------------
-- Usage-metered video call billing hard enforcement
-- ------------------------------------------------------------
ALTER TABLE public.video_call_sessions
  ADD COLUMN IF NOT EXISTS credits_held integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_charged integer,
  ADD COLUMN IF NOT EXISTS billed_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'pending'
    CHECK (billing_status = ANY (ARRAY['pending','settled','insufficient_credits','cancelled']));

CREATE INDEX IF NOT EXISTS idx_video_call_sessions_billing_pending
  ON public.video_call_sessions (status, billing_status, created_at);

CREATE OR REPLACE FUNCTION public.settle_video_call_session(
  p_session_id uuid
)
RETURNS TABLE (
  session_id uuid,
  billing_status text,
  billed_credits integer,
  refunded_credits integer,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session public.video_call_sessions%ROWTYPE;
  v_duration_seconds integer;
  v_rate numeric;
  v_billed integer;
  v_held integer;
  v_refund integer := 0;
  v_extra integer := 0;
  v_final_charged integer;
BEGIN
  SELECT * INTO v_session
  FROM public.video_call_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Video call session not found';
  END IF;

  IF v_session.billing_status IN ('settled', 'insufficient_credits') THEN
    RETURN QUERY
    SELECT v_session.id,
           v_session.billing_status,
           COALESCE(v_session.credits_charged, 0),
           0,
           COALESCE(v_session.total_amount, 0);
    RETURN;
  END IF;

  IF v_session.status = 'active' THEN
    UPDATE public.video_call_sessions
    SET status = 'ended',
        ended_at = COALESCE(ended_at, now())
    WHERE id = v_session.id;

    SELECT * INTO v_session FROM public.video_call_sessions WHERE id = p_session_id FOR UPDATE;
  END IF;

  v_duration_seconds := COALESCE(v_session.duration_seconds,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(v_session.ended_at, now()) - COALESCE(v_session.started_at, now()))))::integer)
  );
  v_rate := COALESCE(v_session.rate_per_minute, 15);
  v_billed := CEIL((v_duration_seconds::numeric / 60.0) * v_rate);
  v_held := GREATEST(0, COALESCE(v_session.credits_held, 0));

  v_refund := GREATEST(0, v_held - v_billed);
  v_extra := GREATEST(0, v_billed - v_held);
  v_final_charged := v_billed;

  IF v_refund > 0 THEN
    PERFORM public.credits_adjust_for_user(
      v_session.viewer_id,
      v_refund,
      'Video call hold release',
      'video_call_refund',
      v_session.id
    );
  END IF;

  IF v_extra > 0 THEN
    BEGIN
      PERFORM public.credits_adjust_for_user(
        v_session.viewer_id,
        -v_extra,
        'Video call metered billing',
        'video_call_settlement',
        v_session.id
      );
    EXCEPTION WHEN OTHERS THEN
      v_final_charged := v_held;
      UPDATE public.video_call_sessions
      SET duration_seconds = v_duration_seconds,
          credits_charged = v_final_charged,
          total_amount = v_final_charged,
          billed_at = now(),
          billing_status = 'insufficient_credits',
          ended_at = COALESCE(ended_at, now()),
          status = 'ended'
      WHERE id = v_session.id;

      INSERT INTO public.earnings (user_id, amount, source_type, source_id, gross_amount, platform_fee, created_at)
      SELECT v_session.creator_id,
             ROUND((v_final_charged::numeric * 0.70)::numeric, 2),
             'video_call',
             v_session.id,
             v_final_charged,
             ROUND((v_final_charged::numeric * 0.30)::numeric, 2),
             now()
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e
        WHERE e.source_type = 'video_call' AND e.source_id = v_session.id
      );

      RETURN QUERY SELECT v_session.id, 'insufficient_credits'::text, v_final_charged, v_refund, v_final_charged::numeric;
      RETURN;
    END;
  END IF;

  UPDATE public.video_call_sessions
  SET duration_seconds = v_duration_seconds,
      credits_charged = v_final_charged,
      total_amount = v_final_charged,
      billed_at = now(),
      billing_status = 'settled',
      ended_at = COALESCE(ended_at, now()),
      status = 'ended'
  WHERE id = v_session.id;

  INSERT INTO public.earnings (user_id, amount, source_type, source_id, gross_amount, platform_fee, created_at)
  SELECT v_session.creator_id,
         ROUND((v_final_charged::numeric * 0.70)::numeric, 2),
         'video_call',
         v_session.id,
         v_final_charged,
         ROUND((v_final_charged::numeric * 0.30)::numeric, 2),
         now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.earnings e
    WHERE e.source_type = 'video_call' AND e.source_id = v_session.id
  );

  RETURN QUERY SELECT v_session.id, 'settled'::text, v_final_charged, v_refund, v_final_charged::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_pending_video_call_sessions(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT id
    FROM public.video_call_sessions
    WHERE status IN ('ended', 'cancelled')
      AND billing_status = 'pending'
    ORDER BY ended_at NULLS LAST, created_at ASC
    LIMIT GREATEST(1, COALESCE(p_limit, 100))
  LOOP
    PERFORM public.settle_video_call_session(v_row.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'papzi_video_billing_settlement_job') THEN
    PERFORM cron.schedule(
      'papzi_video_billing_settlement_job',
      '*/5 * * * *',
      $job$SELECT public.settle_pending_video_call_sessions(150);$job$
    );
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- Recommendation feedback loop (events + adaptive weights)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recommendation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type = ANY (ARRAY['impression','open','like','comment','share','unlock','skip','hide','booking_conversion'])),
  dwell_ms integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_events_user_created
  ON public.recommendation_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendation_events_post_created
  ON public.recommendation_events (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendation_events_type_created
  ON public.recommendation_events (event_type, created_at DESC);

ALTER TABLE public.recommendation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recommendation_events_select_self ON public.recommendation_events;
CREATE POLICY recommendation_events_select_self
  ON public.recommendation_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS recommendation_events_insert_self ON public.recommendation_events;
CREATE POLICY recommendation_events_insert_self
  ON public.recommendation_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.recommendation_weights (
  id boolean PRIMARY KEY DEFAULT true,
  recency_weight numeric NOT NULL DEFAULT 35,
  engagement_weight numeric NOT NULL DEFAULT 2,
  creator_status_weight numeric NOT NULL DEFAULT 13,
  proximity_weight numeric NOT NULL DEFAULT 6,
  completion_weight numeric NOT NULL DEFAULT 5,
  monetization_weight numeric NOT NULL DEFAULT -15,
  safety_weight numeric NOT NULL DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.recommendation_weights (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.recommendation_weight_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recency_weight numeric NOT NULL,
  engagement_weight numeric NOT NULL,
  creator_status_weight numeric NOT NULL,
  proximity_weight numeric NOT NULL,
  completion_weight numeric NOT NULL,
  monetization_weight numeric NOT NULL,
  safety_weight numeric NOT NULL,
  source_window_hours integer NOT NULL DEFAULT 24,
  metrics jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.refresh_recommendation_weights(
  p_window_hours integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window interval := make_interval(hours => GREATEST(1, COALESCE(p_window_hours, 24)));
  v_impressions numeric := 0;
  v_likes numeric := 0;
  v_unlocks numeric := 0;
  v_shares numeric := 0;
  v_conversions numeric := 0;
  v_like_rate numeric := 0;
  v_unlock_rate numeric := 0;
  v_share_rate numeric := 0;
  v_conversion_rate numeric := 0;
  v_recency numeric;
  v_engagement numeric;
  v_monetization numeric;
  v_completion numeric;
  v_safety numeric;
  v_result jsonb;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'impression')::numeric,
    COUNT(*) FILTER (WHERE event_type = 'like')::numeric,
    COUNT(*) FILTER (WHERE event_type = 'unlock')::numeric,
    COUNT(*) FILTER (WHERE event_type = 'share')::numeric,
    COUNT(*) FILTER (WHERE event_type = 'booking_conversion')::numeric
  INTO v_impressions, v_likes, v_unlocks, v_shares, v_conversions
  FROM public.recommendation_events
  WHERE created_at >= now() - v_window;

  IF v_impressions > 0 THEN
    v_like_rate := v_likes / v_impressions;
    v_unlock_rate := v_unlocks / v_impressions;
    v_share_rate := v_shares / v_impressions;
    v_conversion_rate := v_conversions / v_impressions;
  END IF;

  -- Bounded adaptive tuning toward value-driving signals.
  v_recency := LEAST(45, GREATEST(20, 35 - ((v_like_rate + v_unlock_rate) * 8)));
  v_engagement := LEAST(6, GREATEST(1.5, 2 + (v_like_rate * 12) + (v_share_rate * 20)));
  v_monetization := LEAST(-5, GREATEST(-20, -15 + (v_unlock_rate * 80)));
  v_completion := LEAST(12, GREATEST(3, 5 + (v_conversion_rate * 120)));
  v_safety := 10;

  UPDATE public.recommendation_weights
  SET recency_weight = v_recency,
      engagement_weight = v_engagement,
      completion_weight = v_completion,
      monetization_weight = v_monetization,
      safety_weight = v_safety,
      updated_at = now()
  WHERE id = true;

  INSERT INTO public.recommendation_weight_history(
    recency_weight, engagement_weight, creator_status_weight, proximity_weight,
    completion_weight, monetization_weight, safety_weight,
    source_window_hours, metrics
  )
  SELECT
    recency_weight, engagement_weight, creator_status_weight, proximity_weight,
    completion_weight, monetization_weight, safety_weight,
    GREATEST(1, COALESCE(p_window_hours, 24)),
    jsonb_build_object(
      'impressions', v_impressions,
      'likes', v_likes,
      'shares', v_shares,
      'unlocks', v_unlocks,
      'conversions', v_conversions,
      'like_rate', v_like_rate,
      'share_rate', v_share_rate,
      'unlock_rate', v_unlock_rate,
      'conversion_rate', v_conversion_rate
    )
  FROM public.recommendation_weights
  WHERE id = true;

  SELECT jsonb_build_object(
    'window_hours', GREATEST(1, COALESCE(p_window_hours, 24)),
    'impressions', v_impressions,
    'like_rate', v_like_rate,
    'share_rate', v_share_rate,
    'unlock_rate', v_unlock_rate,
    'conversion_rate', v_conversion_rate
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'papzi_recommendation_weight_refresh_job') THEN
    PERFORM cron.schedule(
      'papzi_recommendation_weight_refresh_job',
      '15 * * * *',
      $job$SELECT public.refresh_recommendation_weights(24);$job$
    );
  END IF;
END;
$$;
