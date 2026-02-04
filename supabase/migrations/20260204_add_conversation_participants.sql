-- Add conversation participants table for 1:1 and group conversations
-- Columns: id, conversation_id, user_id, created_at

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

-- Index by user for fast lookups
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON public.conversation_participants (user_id);

-- Make sure Hasura (if present) picks up the table automatically via metadata

-- Optionally, add RLS policy allowing users to read/write their own participant rows
-- (Assumes policies are supported in your environment; you may adjust as needed)
-- Enable row level security
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert a participant for a conversation they are part of or create
CREATE POLICY "participants_insert_by_self_or_admin" ON public.conversation_participants
  FOR INSERT USING (true) WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

-- Allow users to select their own participant rows
CREATE POLICY "participants_select_own" ON public.conversation_participants
  FOR SELECT USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- Allow users to delete their own participant rows
CREATE POLICY "participants_delete_own" ON public.conversation_participants
  FOR DELETE USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- Note: When deploying in production, review policies and roles carefully.
