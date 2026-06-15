-- ============================================================
-- PAPZII LAUNCH CRITICAL FIXES
-- File: supabase/migrations/20260614000000_launch_critical_fixes.sql
-- Resolves critical P0 launch blockers identified in the June 2026 audit
-- Run in Supabase SQL Editor OR via: supabase db push
-- ============================================================

-- ============================================================
-- FIX 1: Auth user trigger (P0-2)
-- Creates a profile row every time a user signs up via Supabase Auth
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    full_name,
    role,
    kyc_status,
    age_verified,
    availability_status,
    created_at
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'client'),
    'pending',
    false,
    'offline',
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- FIX 2: Profiles INSERT + UPDATE RLS policies (P0-3)
-- Without these, users cannot create or update their own profile
-- ============================================================
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;
CREATE POLICY "profiles_insert_self" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- ============================================================
-- FIX 3: Missing ensure_conversation_owner_participant function (P0-4)
-- A trigger on conversations calls this function but it was never defined.
-- Every conversation creation throws: function does not exist
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_conversation_owner_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (NEW.id, NEW.created_by)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;


-- ============================================================
-- FIX 4: KYC documents column name aliases (P0-5)
-- admin-review queries doc_type + storage_path
-- migration originally created document_type + file_url
-- ============================================================
ALTER TABLE public.kyc_documents
  ADD COLUMN IF NOT EXISTS doc_type text,
  ADD COLUMN IF NOT EXISTS storage_path text;

UPDATE public.kyc_documents
SET
  doc_type = COALESCE(doc_type, document_type),
  storage_path = COALESCE(storage_path, file_url)
WHERE doc_type IS NULL OR storage_path IS NULL;


-- ============================================================
-- FIX 5: Create hats table (P0-6)
-- user_hats has a FK to hats but the table may never have been created
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  image_url text,
  rarity text DEFAULT 'common'
    CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  price_credits integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.hats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hats_public_read" ON public.hats;
CREATE POLICY "hats_public_read" ON public.hats
  FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "hats_admin_manage" ON public.hats;
CREATE POLICY "hats_admin_manage" ON public.hats
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- ============================================================
-- FIX 6: availability_status column on profiles (P0-7)
-- dispatch-create filters providers by availability_status
-- Without this column the eligible set is always empty
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS availability_status text DEFAULT 'offline'
  CHECK (availability_status IN ('online', 'available', 'active', 'busy', 'offline'));

-- Sync from existing is_online boolean
UPDATE public.profiles
SET availability_status = CASE
  WHEN is_online = true THEN 'online'
  ELSE 'offline'
END
WHERE availability_status = 'offline' OR availability_status IS NULL;


-- ============================================================
-- FIX 7: ETA booking location columns (P1-4)
-- eta/index.ts queries user_latitude / user_longitude on bookings
-- These columns do not exist; ETA always falls back to 15 min / 45% confidence
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS user_latitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS user_longitude numeric(10, 7);


-- ============================================================
-- FIX 8: Realtime publications for messaging + dispatch (P1-6)
-- Messages will not appear in real-time on the recipient's device
-- without the messages table in the realtime publication
-- ============================================================
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'messages already in supabase_realtime';
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_events;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'notification_events already in supabase_realtime';
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.video_call_sessions;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'video_call_sessions already in supabase_realtime';
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_offers;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'dispatch_offers already in supabase_realtime';
  END;
END $$;


-- ============================================================
-- FIX 9: Remove permissive INSERT policy from final_rls_hotfix.sql (P1-8)
-- WITH CHECK (true) allows any authenticated user to set any created_by value
-- = conversation impersonation vulnerability
-- ============================================================
DROP POLICY IF EXISTS "conversations_insert_auth" ON public.conversations;
