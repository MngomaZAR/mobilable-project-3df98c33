-- Migration: Fix Messaging and Earnings
-- Target: Supabase SQL Editor

-- 1. Create earnings table if not exists
CREATE TABLE IF NOT EXISTS public.earnings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  source_type text NOT NULL CHECK (source_type = ANY (ARRAY['booking', 'tip', 'subscription', 'video_call'])),
  source_id uuid, -- Can be null if generic
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT earnings_pkey PRIMARY KEY (id),
  CONSTRAINT earnings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- 2. Ensure RLS is enabled for earnings
ALTER TABLE public.earnings ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies for earnings
DROP POLICY IF EXISTS earnings_select_owner ON public.earnings;
CREATE POLICY earnings_select_owner ON public.earnings
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 4. Create missing tips/subscriptions if they're not there (Safety check)
CREATE TABLE IF NOT EXISTS public.tips (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  receiver_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tips_pkey PRIMARY KEY (id),
  CONSTRAINT tips_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id),
  CONSTRAINT tips_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  tier_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamp with time zone NOT NULL DEFAULT now(),
  current_period_end timestamp with time zone NOT NULL DEFAULT now() + interval '1 month',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES auth.users(id),
  CONSTRAINT subscriptions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES auth.users(id)
);

-- 5. Hardened RLS for Conversations
-- Allow authenticated users to create a conversation
DROP POLICY IF EXISTS "conversations_insert_authenticated" ON public.conversations;
CREATE POLICY "conversations_insert_authenticated" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Allow participants to see their conversations
DROP POLICY IF EXISTS "conversations_select_participants" ON public.conversations;
CREATE POLICY "conversations_select_participants" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT conversation_id FROM public.conversation_participants
      WHERE user_id = auth.uid()
    )
    OR created_by = auth.uid()
  );

-- 6. Hardened RLS for Conversation Participants
-- Allow users to add anyone to a conversation (needed for starting chats)
DROP POLICY IF EXISTS "conversation_participants_insert_all" ON public.conversation_participants;
CREATE POLICY "conversation_participants_insert_all" ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Allow users to see their own participation
DROP POLICY IF EXISTS "conversation_participants_select_self" ON public.conversation_participants;
CREATE POLICY "conversation_participants_select_self" ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR conversation_id IN (
    SELECT id FROM public.conversations WHERE created_by = auth.uid()
  ));

-- 7. Hardened RLS for Messages
-- Allow participants to insert messages
DROP POLICY IF EXISTS "messages_insert_participants" ON public.messages;
CREATE POLICY "messages_insert_participants" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
    OR
    EXISTS (
        SELECT 1 FROM public.conversation_participants
        WHERE conversation_id = messages.chat_id AND user_id = auth.uid()
    )
  );

-- Allow participants to read messages
DROP POLICY IF EXISTS "messages_select_participants" ON public.messages;
CREATE POLICY "messages_select_participants" ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
    OR
    EXISTS (
        SELECT 1 FROM public.conversation_participants
        WHERE conversation_id = messages.chat_id AND user_id = auth.uid()
    )
  );
