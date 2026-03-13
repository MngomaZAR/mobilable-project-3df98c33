-- Backend RLS alignment: messaging + subscriptions/tips FKs
-- Goal: remove circular RLS recursion, allow participant visibility,
-- and align monetization foreign keys with profiles.

-- =============================
-- Messaging: conversations
-- =============================
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE pol text;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename='conversations' AND schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversations', pol);
  END LOOP;
END $$;

CREATE POLICY "conv_select_member" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id
        AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "conv_insert_auth" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "conv_update_creator" ON public.conversations
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "conv_delete_creator" ON public.conversations
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- =============================
-- Messaging: conversation_participants
-- =============================
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE pol text;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename='conversation_participants' AND schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversation_participants', pol);
  END LOOP;
END $$;

-- Allow users to view participant rows for conversations they belong to.
-- This avoids referencing conversations (no circular RLS).
CREATE POLICY "cp_select_member" ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp2
      WHERE cp2.conversation_id = conversation_participants.conversation_id
        AND cp2.user_id = auth.uid()
    )
  );

-- Allow inserting yourself, or if you created the conversation.
CREATE POLICY "cp_insert_creator_or_self" ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND c.created_by = auth.uid()
    )
  );

CREATE POLICY "cp_update_self" ON public.conversation_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- =============================
-- Messaging: messages
-- =============================
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE pol text;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename='messages' AND schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.messages', pol);
  END LOOP;
END $$;

CREATE POLICY "msg_select_member" ON public.messages
  FOR SELECT TO authenticated
  USING (
    messages.chat_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = messages.chat_id
        AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "msg_insert_member" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND messages.chat_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = messages.chat_id
        AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "msg_update_self" ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid());

CREATE POLICY "msg_delete_self" ON public.messages
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid());

-- =============================
-- Subscriptions/tips FK alignment
-- =============================
-- Align foreign keys to profiles (prevents demo/profile-only rows from failing).
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_subscriber_id_fkey,
  DROP CONSTRAINT IF EXISTS subscriptions_creator_id_fkey;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT subscriptions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.tips
  DROP CONSTRAINT IF EXISTS tips_sender_id_fkey,
  DROP CONSTRAINT IF EXISTS tips_receiver_id_fkey;

ALTER TABLE public.tips
  ADD CONSTRAINT tips_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT tips_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- =============================
-- RLS for subscriptions/tips (ensure present)
-- =============================
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_insert" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_update" ON public.subscriptions;

CREATE POLICY "subscriptions_select" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (subscriber_id = auth.uid() OR creator_id = auth.uid());

CREATE POLICY "subscriptions_insert" ON public.subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (subscriber_id = auth.uid());

CREATE POLICY "subscriptions_update" ON public.subscriptions
  FOR UPDATE TO authenticated
  USING (subscriber_id = auth.uid() OR creator_id = auth.uid());

DROP POLICY IF EXISTS "tips_select" ON public.tips;
DROP POLICY IF EXISTS "tips_insert" ON public.tips;

CREATE POLICY "tips_select" ON public.tips
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "tips_insert" ON public.tips
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());
