-- =============================================================
-- FINAL MESSAGING & VISIBILITY HOTFIX
-- =============================================================

-- Enable RLS on all related tables (just in case)
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.messages ENABLE ROW LEVEL SECURITY;

-- 1. Profiles Visibility (Publicly viewable profiles)
DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;
CREATE POLICY "profiles_select_public" ON public.profiles
  FOR SELECT TO public
  USING (true);

-- 2. Posts Visibility (Publicly viewable feed)
DROP POLICY IF EXISTS "posts_select_public" ON public.posts;
CREATE POLICY "posts_select_public" ON public.posts
  FOR SELECT TO public
  USING (true);

-- 3. Conversations (Robust Policies)
-- Allow authenticated users to create conversations
DROP POLICY IF EXISTS "conversations_insert_auth" ON public.conversations;
CREATE POLICY "conversations_insert_auth" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Allow participants to see their conversations
DROP POLICY IF EXISTS "conversations_select_auth" ON public.conversations;
CREATE POLICY "conversations_select_auth" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid() 
    OR id IN (
      SELECT conversation_id FROM public.conversation_participants 
      WHERE user_id = auth.uid()
    )
  );

-- 4. Conversation Participants (Allow adding anyone to start a chat)
DROP POLICY IF EXISTS "participants_insert_auth" ON public.conversation_participants;
CREATE POLICY "participants_insert_auth" ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "participants_select_auth" ON public.conversation_participants;
CREATE POLICY "participants_select_auth" ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() 
    OR conversation_id IN (
      SELECT id FROM public.conversations WHERE created_by = auth.uid()
    )
    OR conversation_id IN (
       SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid()
    )
  );

-- 5. Messages (Allow participants to read and write)
DROP POLICY IF EXISTS "messages_insert_auth" ON public.messages;
CREATE POLICY "messages_insert_auth" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE (conversation_id = messages.conversation_id OR conversation_id = messages.chat_id)
      AND user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "messages_select_auth" ON public.messages;
CREATE POLICY "messages_select_auth" ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE (conversation_id = messages.conversation_id OR conversation_id = messages.chat_id)
      AND user_id = auth.uid()
    )
  );
