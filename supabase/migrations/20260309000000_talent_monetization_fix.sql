-- Migration: 20260309000000_talent_monetization_fix.sql
-- Goal: Fix missing tables and RLS policies for global-scale talent marketplace.

-- 1. Create missing Monetization Tables
CREATE TABLE IF NOT EXISTS public.tips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID REFERENCES public.profiles(id) NOT NULL,
    receiver_id UUID REFERENCES public.profiles(id) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscription_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES public.profiles(id) NOT NULL,
    name TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscriber_id UUID REFERENCES public.profiles(id) NOT NULL,
    creator_id UUID REFERENCES public.profiles(id) NOT NULL,
    tier_id UUID REFERENCES public.subscription_tiers(id),
    status TEXT NOT NULL DEFAULT 'active',
    current_period_start TIMESTAMPTZ DEFAULT now(),
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.earnings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    source_type TEXT NOT NULL, -- 'booking', 'tip', 'subscription'
    source_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Harden Profiles for Unified Talent
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token TEXT;

-- 3. RLS Policies Hardening

-- Conversations: Allow participants to create and view
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own conversations" 
ON public.conversations FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.conversation_participants 
        WHERE conversation_id = conversations.id AND user_id = auth.uid()
    )
);

CREATE POLICY "Users can create conversations" 
ON public.conversations FOR INSERT 
WITH CHECK (true); -- Usually restricted by bridge table, but allowing for Edge function fallback

-- Conversation Participants: Essential for the bridge
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view participants of their conversations" 
ON public.conversation_participants FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.conversation_participants AS cp
        WHERE cp.conversation_id = conversation_participants.conversation_id AND cp.user_id = auth.uid()
    )
);

CREATE POLICY "Users can add participants to their conversations"
ON public.conversation_participants FOR INSERT
WITH CHECK (auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM public.conversation_participants 
    WHERE conversation_id = conversation_participants.conversation_id AND user_id = auth.uid()
));

-- Messages: RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view messages in their conversations"
ON public.messages FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.conversation_participants 
        WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
);

CREATE POLICY "Users can send messages"
ON public.messages FOR INSERT
WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
        SELECT 1 FROM public.conversation_participants 
        WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
);

-- Bookings: RLS
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own bookings"
ON public.bookings FOR SELECT
USING (auth.uid() = client_id OR auth.uid() = photographer_id);

CREATE POLICY "Clients can create bookings"
ON public.bookings FOR INSERT
WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Talent can update their booking status"
ON public.bookings FOR UPDATE
USING (auth.uid() = photographer_id)
WITH CHECK (auth.uid() = photographer_id);

-- Monetization RLS
ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their tips" ON public.tips FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
CREATE POLICY "Users can send tips" ON public.tips FOR INSERT WITH CHECK (auth.uid() = sender_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their subscriptions" ON public.subscriptions FOR SELECT USING (auth.uid() = subscriber_id OR auth.uid() = creator_id);
CREATE POLICY "Users can subscribe" ON public.subscriptions FOR INSERT WITH CHECK (auth.uid() = subscriber_id);
