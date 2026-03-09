-- ============================================================
-- PAPZI DEFINITIVE RLS FIX v2
-- File: supabase/migrations/20260310000001_definitive_rls_fix.sql
-- 
-- PURPOSE: Fix infinite RLS recursion that completely breaks chat.
-- Drops ALL previous conflicting policies and creates clean ones.
-- 
-- Root cause of infinite recursion:
--   conversations_select_member -> is_conversation_member() 
--   -> reads conversation_participants
--   -> conversation_participants_select_self reads FROM conversations
--   -> triggers conversations_select_member again -> LOOP
--
-- HOW TO APPLY: Run this in Supabase SQL Editor
-- ============================================================


-- ============================================================
-- SECTION 1: CONVERSATIONS — Drop all existing SELECT/INSERT policies
-- ============================================================
DO $$ DECLARE pol text;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename='conversations' AND schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversations', pol);
  END LOOP;
END $$;

-- Clean INSERT: any authenticated user can start a conversation
CREATE POLICY "conv_insert" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Clean SELECT: see conversations you created or are a participant in
-- NOTE: The subquery here goes INTO conversation_participants which has a simple uid() check - NO circular reference back to conversations
CREATE POLICY "conv_select" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR id IN (
      SELECT cp.conversation_id
      FROM public.conversation_participants cp
      WHERE cp.user_id = auth.uid()
    )
  );

CREATE POLICY "conv_update_creator" ON public.conversations
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "conv_delete_creator" ON public.conversations
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by);


-- ============================================================
-- SECTION 2: CONVERSATION_PARTICIPANTS — Drop all existing policies
-- ============================================================
DO $$ DECLARE pol text;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename='conversation_participants' AND schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversation_participants', pol);
  END LOOP;
END $$;

-- Clean SELECT: a user can ONLY see their own participation rows
-- NO subquery into conversations table here — this breaks the infinite loop
CREATE POLICY "cp_select" ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Clean INSERT: authenticated users can be added as participants
CREATE POLICY "cp_insert" ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow updating last_read_at for yourself
CREATE POLICY "cp_update" ON public.conversation_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());


-- ============================================================
-- SECTION 3: MESSAGES — Drop all existing SELECT/INSERT policies
-- ============================================================
DO $$ DECLARE pol text;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename='messages' AND schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.messages', pol);
  END LOOP;
END $$;

-- Clean SELECT: see messages from conversations you participate in
-- Uses both chat_id and conversation_id since DB has both columns
CREATE POLICY "msg_select" ON public.messages
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT cp.conversation_id FROM public.conversation_participants cp WHERE cp.user_id = auth.uid()
    )
    OR chat_id IN (
      SELECT cp.conversation_id FROM public.conversation_participants cp WHERE cp.user_id = auth.uid()
    )
  );

-- Clean INSERT: can send messages to conversations you are part of
CREATE POLICY "msg_insert" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      conversation_id IN (
        SELECT cp.conversation_id FROM public.conversation_participants cp WHERE cp.user_id = auth.uid()
      )
      OR chat_id IN (
        SELECT cp.conversation_id FROM public.conversation_participants cp WHERE cp.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "msg_delete_self" ON public.messages
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid());

CREATE POLICY "msg_update_owner" ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid());


-- ============================================================
-- SECTION 4: FEED — Ensure posts and profiles are publicly readable
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='posts' AND schemaname='public' AND policyname='posts_public_read') THEN
    CREATE POLICY "posts_public_read" ON public.posts FOR SELECT TO public USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND schemaname='public' AND policyname='profiles_public_read') THEN
    CREATE POLICY "profiles_public_read" ON public.profiles FOR SELECT TO public USING (true);
  END IF;
END $$;


-- ============================================================
-- SECTION 5: TIPS & SUBSCRIPTIONS — Enable RLS (was disabled!)
-- ============================================================
ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tips_select" ON public.tips;
CREATE POLICY "tips_select" ON public.tips
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

DROP POLICY IF EXISTS "tips_insert" ON public.tips;
CREATE POLICY "tips_insert" ON public.tips
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());


ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select" ON public.subscriptions;
CREATE POLICY "subscriptions_select" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (subscriber_id = auth.uid() OR creator_id = auth.uid());

DROP POLICY IF EXISTS "subscriptions_insert" ON public.subscriptions;
CREATE POLICY "subscriptions_insert" ON public.subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (subscriber_id = auth.uid());


-- ============================================================
-- SECTION 6: CONVERSATION_MEMBERS — Also clean up for consistency
-- ============================================================
DO $$ DECLARE pol text;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename='conversation_members' AND schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversation_members', pol);
  END LOOP;
END $$;

CREATE POLICY "cm_select" ON public.conversation_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "cm_insert" ON public.conversation_members
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
