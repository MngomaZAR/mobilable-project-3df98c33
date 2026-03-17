-- ============================================================
-- PAPZI WORLD-CLASS FEATURES MIGRATION
-- Phase 0-6: Platform Infrastructure to Creator Monetisation
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- PHASE 0: SELF-HOSTED ANALYTICS & CRASH REPORTING
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  session_id text,
  event_name text NOT NULL,
  screen text,
  properties jsonb DEFAULT '{}',
  platform text,
  app_version text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crash_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  error_message text NOT NULL,
  error_stack text,
  screen text,
  context jsonb DEFAULT '{}',
  platform text,
  app_version text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crash_logs_created ON crash_logs(created_at DESC);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crash_logs ENABLE ROW LEVEL SECURITY;

-- Users can insert their own events; admin can read all
CREATE POLICY "insert own analytics" ON analytics_events FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "admin reads analytics" ON analytics_events FOR SELECT USING (
  auth.uid() IN (SELECT id FROM profiles WHERE role = 'admin')
);
CREATE POLICY "insert crash logs" ON crash_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "admin reads crash logs" ON crash_logs FOR SELECT USING (
  auth.uid() IN (SELECT id FROM profiles WHERE role = 'admin')
);

-- ──────────────────────────────────────────────────────────────
-- PHASE 1: ONLINE STATUS & REAL-TIME AVAILABILITY
-- ──────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_online boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_profiles_online ON profiles(is_online) WHERE is_online = true;

-- Function to auto-set offline after 10 minutes of inactivity
CREATE OR REPLACE FUNCTION expire_online_status() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE profiles SET is_online = false
  WHERE is_online = true AND last_seen_at < now() - interval '10 minutes';
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- PHASE 3: CHAT ENHANCEMENTS (Typing, Reactions, Read Receipts)
-- ──────────────────────────────────────────────────────────────

-- Read receipts
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Reply-to threading
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_preview text;

-- Audio messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_url text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_duration_seconds integer;

-- Message soft delete
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Message reactions
CREATE TABLE IF NOT EXISTS message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('❤️','😂','😮','😢','👏','🔥','💯','😍')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants can manage reactions" ON message_reactions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversation_participants cp
    JOIN messages m ON m.conversation_id = cp.conversation_id
    WHERE m.id = message_id AND cp.user_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);

-- Pinned messages
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_message_id uuid REFERENCES messages(id) ON DELETE SET NULL;

-- ──────────────────────────────────────────────────────────────
-- PHASE 4: FEED ENHANCEMENTS (Video, Stories, Bookmarks, Search)
-- ──────────────────────────────────────────────────────────────

-- Video posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_url text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_thumbnail_url text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_type text DEFAULT 'image' CHECK (media_type IN ('image','video'));
ALTER TABLE posts ADD COLUMN IF NOT EXISTS view_count integer DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS share_count integer DEFAULT 0;

-- PPV posts (locked content in feed)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS unlock_price numeric(10,2);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS subscribers_only boolean DEFAULT false;

-- Content expiry
ALTER TABLE posts ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Full-text search on posts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE posts ADD COLUMN search_vector tsvector;
    UPDATE posts SET search_vector = to_tsvector('english', coalesce(caption, ''));
    CREATE INDEX idx_posts_fts ON posts USING GIN(search_vector);
    CREATE OR REPLACE FUNCTION posts_search_vector_update() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      NEW.search_vector := to_tsvector('english', coalesce(NEW.caption, ''));
      RETURN NEW;
    END; $f$;
    CREATE TRIGGER posts_search_vector_trigger
      BEFORE INSERT OR UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();
  END IF;
END $$;

-- Full-text search on profiles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE profiles ADD COLUMN search_vector tsvector;
    UPDATE profiles SET search_vector = to_tsvector('english', coalesce(full_name,'') || ' ' || coalesce(bio,'') || ' ' || coalesce(city,''));
    CREATE INDEX idx_profiles_fts ON profiles USING GIN(search_vector);
    CREATE OR REPLACE FUNCTION profiles_search_vector_update() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      NEW.search_vector := to_tsvector('english', coalesce(NEW.full_name,'') || ' ' || coalesce(NEW.bio,'') || ' ' || coalesce(NEW.city,''));
      RETURN NEW;
    END; $f$;
    CREATE TRIGGER profiles_search_vector_trigger
      BEFORE INSERT OR UPDATE ON profiles
      FOR EACH ROW EXECUTE FUNCTION profiles_search_vector_update();
  END IF;
END $$;

-- Post bookmarks
CREATE TABLE IF NOT EXISTS post_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, post_id)
);

ALTER TABLE post_bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bookmarks" ON post_bookmarks FOR ALL USING (auth.uid() = user_id);

-- Post unlocks (PPV)
CREATE TABLE IF NOT EXISTS post_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  amount_paid numeric(10,2),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, post_id)
);

ALTER TABLE post_unlocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own unlocks" ON post_unlocks FOR ALL USING (auth.uid() = user_id);

-- Comment likes
ALTER TABLE comments ADD COLUMN IF NOT EXISTS likes_count integer DEFAULT 0;

CREATE TABLE IF NOT EXISTS comment_likes (
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, comment_id)
);

ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own comment likes" ON comment_likes FOR ALL USING (auth.uid() = user_id);

-- Stories (24h expiry)
CREATE TABLE IF NOT EXISTS stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  media_url text NOT NULL,
  media_type text DEFAULT 'image' CHECK (media_type IN ('image','video')),
  caption text,
  sticker_data jsonb DEFAULT '[]',
  view_count integer DEFAULT 0,
  expires_at timestamptz DEFAULT now() + interval '24 hours',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS story_views (
  story_id uuid REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  viewed_at timestamptz DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active stories visible" ON stories FOR SELECT USING (expires_at > now());
CREATE POLICY "own stories insert" ON stories FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "own stories delete" ON stories FOR DELETE USING (auth.uid() = author_id);
CREATE POLICY "log story views" ON story_views FOR INSERT WITH CHECK (auth.uid() = viewer_id);
CREATE POLICY "creator sees views" ON story_views FOR SELECT USING (
  auth.uid() = viewer_id OR auth.uid() IN (SELECT author_id FROM stories WHERE id = story_id)
);

-- ──────────────────────────────────────────────────────────────
-- PHASE 5: BOOKING ENHANCEMENTS
-- ──────────────────────────────────────────────────────────────

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pricing_mode text DEFAULT 'flat' CHECK (pricing_mode IN ('hourly','half_day','full_day','flat'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dispute_reason text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS addons jsonb DEFAULT '[]';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_instant boolean DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_type text DEFAULT 'photography' CHECK (service_type IN ('photography','modeling','combined','video_call'));

-- ──────────────────────────────────────────────────────────────
-- PHASE 6: CREATOR MONETISATION
-- ──────────────────────────────────────────────────────────────

-- Enhanced subscription tiers
ALTER TABLE subscription_tiers ADD COLUMN IF NOT EXISTS perks jsonb DEFAULT '[]';
ALTER TABLE subscription_tiers ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE subscription_tiers ADD COLUMN IF NOT EXISTS max_subscribers integer;
ALTER TABLE subscription_tiers ADD COLUMN IF NOT EXISTS color text DEFAULT '#8b5cf6';

-- Tip goals
CREATE TABLE IF NOT EXISTS tip_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  target_amount numeric(10,2) NOT NULL,
  current_amount numeric(10,2) DEFAULT 0,
  is_active boolean DEFAULT true,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tip_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creator manages goals" ON tip_goals FOR ALL USING (auth.uid() = creator_id);
CREATE POLICY "goals visible to all" ON tip_goals FOR SELECT USING (is_active = true);

-- Payout methods (bank accounts)
CREATE TABLE IF NOT EXISTS payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  account_holder text NOT NULL,
  account_number text NOT NULL,
  account_type text DEFAULT 'cheque' CHECK (account_type IN ('cheque','savings','current')),
  branch_code text,
  is_default boolean DEFAULT false,
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payout_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own payout methods" ON payout_methods FOR ALL USING (auth.uid() = user_id);

-- Creator highlight posts (pinned to top of profile)
CREATE TABLE IF NOT EXISTS profile_highlights (
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  display_order integer DEFAULT 0,
  PRIMARY KEY (user_id, post_id)
);

ALTER TABLE profile_highlights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own highlights" ON profile_highlights FOR ALL USING (auth.uid() = user_id);

-- Verified creator badge
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_verified_creator boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- Block/mute users
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own blocks" ON user_blocks FOR ALL USING (auth.uid() = blocker_id);

-- ──────────────────────────────────────────────────────────────
-- PHASE 8: NOTIFICATIONS ENHANCEMENT
-- ──────────────────────────────────────────────────────────────

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category text DEFAULT 'system'
  CHECK (category IN ('booking','message','social','earnings','system','creator'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_type text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_payload jsonb;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS icon text;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

-- ──────────────────────────────────────────────────────────────
-- HELPER: Platform stats view for HomeScreen real metrics
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW platform_stats AS
SELECT
  (SELECT count(*) FROM profiles WHERE role = 'photographer') AS photographer_count,
  (SELECT count(*) FROM profiles WHERE role = 'model') AS model_count,
  (SELECT count(*) FROM profiles) AS total_users,
  (SELECT count(*) FROM bookings WHERE status = 'completed') AS completed_bookings,
  (SELECT COALESCE(AVG(rating), 5.0) FROM reviews WHERE moderation_status = 'approved') AS avg_rating;
