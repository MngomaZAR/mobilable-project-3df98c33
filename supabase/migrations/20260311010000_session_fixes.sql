-- Session fixes: March 11 2026
-- Applied directly to production via Supabase MCP during overhaul session

-- messages: locked media columns
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS preview_url text,
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unlocked boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unlock_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

-- tips: payment tracking columns  
ALTER TABLE public.tips 
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'
    CHECK (status = ANY(ARRAY['pending','completed','failed']));

-- earnings: source tracking
ALTER TABLE public.earnings
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'booking'
    CHECK (source_type = ANY(ARRAY['booking','tip','subscription','video_call'])),
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS payout_rate numeric DEFAULT 0.70,
  ADD COLUMN IF NOT EXISTS gross_amount numeric,
  ADD COLUMN IF NOT EXISTS platform_fee numeric;

-- video_call_sessions table
CREATE TABLE IF NOT EXISTS public.video_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_name text NOT NULL,
  rate_per_minute numeric NOT NULL DEFAULT 15,
  currency text NOT NULL DEFAULT 'ZAR',
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,
  total_amount numeric,
  status text NOT NULL DEFAULT 'active' CHECK (status = ANY(ARRAY['active','ended','cancelled'])),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.video_call_sessions ENABLE ROW LEVEL SECURITY;

-- RLS
CREATE POLICY IF NOT EXISTS "video_calls_select_participants" ON public.video_call_sessions FOR SELECT USING (auth.uid() = creator_id OR auth.uid() = viewer_id);
CREATE POLICY IF NOT EXISTS "video_calls_insert_viewer" ON public.video_call_sessions FOR INSERT WITH CHECK (auth.uid() = viewer_id);
CREATE POLICY IF NOT EXISTS "video_calls_update_participants" ON public.video_call_sessions FOR UPDATE USING (auth.uid() = creator_id OR auth.uid() = viewer_id);

-- Tip earnings trigger (70/30 split)
CREATE OR REPLACE FUNCTION public.handle_tip_earnings()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.earnings (user_id, amount, source_type, source_id, gross_amount, platform_fee, created_at)
  VALUES (NEW.receiver_id, NEW.amount * 0.70, 'tip', NEW.id, NEW.amount, NEW.amount * 0.30, NOW())
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_tip_create_earnings ON public.tips;
CREATE TRIGGER on_tip_create_earnings AFTER INSERT ON public.tips FOR EACH ROW EXECUTE FUNCTION public.handle_tip_earnings();

-- Payment completed earnings trigger
CREATE OR REPLACE FUNCTION public.handle_payment_completed_earnings()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_booking public.bookings%ROWTYPE; v_payout numeric;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT * INTO v_booking FROM public.bookings WHERE id = NEW.booking_id LIMIT 1;
    IF v_booking.id IS NOT NULL THEN
      v_payout := COALESCE(v_booking.photographer_payout, NEW.amount * 0.70);
      INSERT INTO public.earnings (user_id, amount, source_type, source_id, gross_amount, platform_fee, created_at)
      VALUES (v_booking.photographer_id, v_payout, 'booking', NEW.booking_id, NEW.amount, NEW.amount * 0.30, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_payment_completed_earnings ON public.payments;
CREATE TRIGGER on_payment_completed_earnings AFTER UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.handle_payment_completed_earnings();

-- Fix enqueue_new_message_event: chat_id column + queued status
CREATE OR REPLACE FUNCTION public.enqueue_new_message_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_booking_id uuid;
BEGIN
  SELECT c.booking_id INTO v_booking_id FROM public.conversations c WHERE c.id = NEW.chat_id;
  INSERT INTO public.notification_events (event_type, user_id, title, body, data, status, created_at)
  SELECT 'new_message', cp.user_id, 'New message',
    CASE WHEN NEW.message_type = 'media' THEN '📷 Sent a photo' ELSE LEFT(COALESCE(NEW.body,''),80) END,
    jsonb_build_object('conversation_id', NEW.chat_id, 'sender_id', NEW.sender_id, 'message_type', NEW.message_type, 'booking_id', v_booking_id),
    'queued', NOW()
  FROM public.conversation_participants cp
  WHERE cp.conversation_id = NEW.chat_id AND cp.user_id != NEW.sender_id;
  RETURN NEW;
END; $$;

-- tips RLS
DROP POLICY IF EXISTS "tips_insert_sender" ON public.tips;
DROP POLICY IF EXISTS "tips_select_participants" ON public.tips;
CREATE POLICY "tips_insert_sender" ON public.tips FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "tips_select_participants" ON public.tips FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
