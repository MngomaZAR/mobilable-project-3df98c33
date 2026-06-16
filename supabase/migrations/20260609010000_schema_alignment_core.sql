-- ============================================================
-- SCHEMA ALIGNMENT: frontend/backend contract repair
-- ============================================================
--
-- This migration adds the app-facing tables that the current React Native
-- code already expects. The goal is to remove silent drift between the UI,
-- services, and database contract without forcing a broad rewrite.

-- ------------------------------------------------------------
-- Notification events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  category text NOT NULL DEFAULT 'system' CHECK (category IN ('booking', 'message', 'social', 'earnings', 'system', 'creator')),
  action_type text,
  action_payload jsonb,
  icon text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_events_user_created
  ON public.notification_events(user_id, created_at DESC);

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification events own" ON public.notification_events;
CREATE POLICY "notification events own" ON public.notification_events
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Feed engagement tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_likes (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON public.post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON public.post_likes(user_id);

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own post likes" ON public.post_likes;
CREATE POLICY "own post likes" ON public.post_likes
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON public.post_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_user_id ON public.post_comments(user_id);

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post comments read all" ON public.post_comments;
CREATE POLICY "post comments read all" ON public.post_comments
FOR SELECT USING (true);

DROP POLICY IF EXISTS "own post comments" ON public.post_comments;
CREATE POLICY "own post comments" ON public.post_comments
FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own post comments modify" ON public.post_comments;
CREATE POLICY "own post comments modify" ON public.post_comments
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS tr_sync_post_like_count ON public.post_likes;
CREATE TRIGGER tr_sync_post_like_count
AFTER INSERT OR DELETE ON public.post_likes
FOR EACH ROW EXECUTE FUNCTION public.sync_post_like_count();

DROP TRIGGER IF EXISTS tr_sync_post_comment_count ON public.post_comments;
CREATE TRIGGER tr_sync_post_comment_count
AFTER INSERT OR DELETE ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public.sync_post_comment_count();

-- ------------------------------------------------------------
-- Media library
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  bucket text NOT NULL,
  object_path text NOT NULL,
  mime_type text,
  is_locked boolean NOT NULL DEFAULT false,
  price_zar numeric(10,2),
  title text,
  preview_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_owner_created
  ON public.media_assets(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_assets_booking
  ON public.media_assets(booking_id);

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media assets read all" ON public.media_assets;
CREATE POLICY "media assets read all" ON public.media_assets
FOR SELECT USING (true);

DROP POLICY IF EXISTS "media assets owner write" ON public.media_assets;
CREATE POLICY "media assets owner write" ON public.media_assets
FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "media assets owner update" ON public.media_assets;
CREATE POLICY "media assets owner update" ON public.media_assets
FOR UPDATE USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "media assets owner delete" ON public.media_assets;
CREATE POLICY "media assets owner delete" ON public.media_assets
FOR DELETE USING (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS public.media_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.media_access_logs
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.media_assets(id) ON DELETE CASCADE;
ALTER TABLE public.media_access_logs
  ADD COLUMN IF NOT EXISTS accessed_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_media_access_logs_asset
  ON public.media_access_logs(asset_id, accessed_at DESC);

ALTER TABLE public.media_access_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media access own" ON public.media_access_logs;
CREATE POLICY "media access own" ON public.media_access_logs
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Model / creator monetisation helpers
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.model_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  rate_zar numeric(10,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  requires_age_verification boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(model_id, service_type)
);

CREATE INDEX IF NOT EXISTS idx_model_services_model_active
  ON public.model_services(model_id, is_active);

DROP TRIGGER IF EXISTS trg_model_services_updated_at ON public.model_services;
CREATE TRIGGER trg_model_services_updated_at
BEFORE UPDATE ON public.model_services
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.model_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "model services own" ON public.model_services;
CREATE POLICY "model services own" ON public.model_services
FOR ALL USING (auth.uid() = model_id)
WITH CHECK (auth.uid() = model_id);

CREATE TABLE IF NOT EXISTS public.tip_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  target_amount numeric(10,2) NOT NULL,
  current_amount numeric(10,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tip_goals_creator_active
  ON public.tip_goals(creator_id, is_active, created_at DESC);

-- ------------------------------------------------------------
-- Availability / scheduling
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, day_of_week, start_time, end_time)
);

ALTER TABLE public.availability
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS day_of_week smallint,
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_availability_user_day
  ON public.availability(user_id, day_of_week);

ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "availability own" ON public.availability;
CREATE POLICY "availability own" ON public.availability
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.blocked_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_date date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, blocked_date)
);

ALTER TABLE public.blocked_dates
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS blocked_date date,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_blocked_dates_user_date
  ON public.blocked_dates(user_id, blocked_date);

ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocked dates own" ON public.blocked_dates;
CREATE POLICY "blocked dates own" ON public.blocked_dates
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Push notifications / device tokens
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform text,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, expo_push_token)
);

ALTER TABLE public.push_tokens
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS expo_push_token text,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_enabled
  ON public.push_tokens(user_id, enabled);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push tokens own" ON public.push_tokens;
CREATE POLICY "push tokens own" ON public.push_tokens
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Support, reports, and account deletion
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject text NOT NULL,
  category text NOT NULL CHECK (category IN ('general', 'billing', 'safety', 'technical', 'account')),
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support tickets own" ON public.support_tickets;
CREATE POLICY "support tickets own" ON public.support_tickets
FOR ALL USING (auth.uid() = created_by)
WITH CHECK (auth.uid() = created_by);

CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post', 'profile', 'booking', 'message')),
  target_id text NOT NULL,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'escalated', 'resolved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_reports_updated_at ON public.reports;
CREATE TRIGGER trg_reports_updated_at
BEFORE UPDATE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports own" ON public.reports;
CREATE POLICY "reports own" ON public.reports
FOR ALL USING (auth.uid() = created_by)
WITH CHECK (auth.uid() = created_by);

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'completed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account deletions own" ON public.account_deletion_requests;
CREATE POLICY "account deletions own" ON public.account_deletion_requests
FOR ALL USING (auth.uid() = created_by)
WITH CHECK (auth.uid() = created_by);
