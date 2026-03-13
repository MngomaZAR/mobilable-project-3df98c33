-- Messaging RLS hotfix: allow authenticated users to create conversations
-- and allow conversation creators to add participants safely.

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conv_insert_auth" ON public.conversations;
CREATE POLICY "conv_insert_auth" ON public.conversations
  FOR INSERT WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "conv_select_member" ON public.conversations;
CREATE POLICY "conv_select_member" ON public.conversations
  FOR SELECT USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id AND cp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cp_select_member" ON public.conversation_participants;
CREATE POLICY "cp_select_member" ON public.conversation_participants
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND c.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cp_insert_creator_or_self" ON public.conversation_participants;
CREATE POLICY "cp_insert_creator_or_self" ON public.conversation_participants
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND c.created_by = auth.uid()
    )
  );
