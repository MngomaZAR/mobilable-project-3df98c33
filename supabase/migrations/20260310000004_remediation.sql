-- ============================================================
-- REMEDIATION MIGRATION (Idempotent Version)
-- Generated: 2026-03-10
-- Fixes critical issues identified in audit
-- ============================================================

-- ============================================================
-- SECTION 1: DROP BROKEN TRIGGER FUNCTIONS
-- ============================================================
DROP TRIGGER IF EXISTS ensure_message_booking ON public.messages;
DROP TRIGGER IF EXISTS sync_chat_metadata ON public.messages;
DROP FUNCTION IF EXISTS public.ensure_message_booking();
DROP FUNCTION IF EXISTS public.sync_chat_metadata();
DROP FUNCTION IF EXISTS public.handle_successful_payment CASCADE;
DROP FUNCTION IF EXISTS public.process_payment_transaction CASCADE;
DROP FUNCTION IF EXISTS public.handle_chats_updated_at CASCADE;

-- ============================================================
-- SECTION 2: FIX bookings.start_time / end_time TYPE
-- ============================================================
DO $$
BEGIN
  -- Add columns if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'start_datetime') THEN
    ALTER TABLE public.bookings ADD COLUMN start_datetime timestamptz;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'end_datetime') THEN
    ALTER TABLE public.bookings ADD COLUMN end_datetime timestamptz;
  END IF;

  -- Backfill ONLY if old columns still exist
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'start_time') THEN
    UPDATE public.bookings
    SET
      start_datetime = (booking_date + start_time) AT TIME ZONE 'UTC',
      end_datetime   = (booking_date + end_time)   AT TIME ZONE 'UTC'
    WHERE booking_date IS NOT NULL
      AND start_time   IS NOT NULL
      AND end_time     IS NOT NULL;

    -- Now drop the old columns
    ALTER TABLE public.bookings DROP COLUMN start_time;
    ALTER TABLE public.bookings DROP COLUMN end_time;
  END IF;
END $$;

-- Fix prevent_booking_overlap to use the new timestamptz columns
CREATE OR REPLACE FUNCTION public.prevent_booking_overlap()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if exists (
    select 1 from public.bookings b
    where b.photographer_id = new.photographer_id
      and b.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and b.status in ('pending', 'accepted', 'completed')
      and b.start_datetime   is not null
      and b.end_datetime     is not null
      and new.start_datetime is not null
      and new.end_datetime   is not null
      and tstzrange(b.start_datetime, b.end_datetime) &&
          tstzrange(new.start_datetime, new.end_datetime)
  ) then
    raise exception 'Schedule conflict for photographer %', new.photographer_id;
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS prevent_booking_overlap ON public.bookings;
CREATE TRIGGER prevent_booking_overlap
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_booking_overlap();


-- ============================================================
-- SECTION 3: FIX DOUBLE PRICING TRIGGER
-- ============================================================
DROP TRIGGER IF EXISTS trg_recalculate_booking_amounts ON public.bookings;
DROP FUNCTION IF EXISTS public.recalculate_booking_amounts();

CREATE OR REPLACE FUNCTION public.calculate_booking_pricing()
RETURNS trigger LANGUAGE plpgsql AS $$
declare
  base_per_photo       numeric := 10;
  distance_fee_per_km  numeric := 0.75;
  p_commission_rate    numeric := 0.30;
  rating               numeric := 0;
  rating_multiplier    numeric := 1.0;
  base_price           numeric := 0;
  distance_fee         numeric := 0;
begin
  if new.pricing_mode is null then
    new.pricing_mode := 'paparazzi';
  end if;
  if new.photo_count is null and new.pricing_mode = 'paparazzi' then
    new.photo_count := 4;
  end if;
  if new.event_package_id is null and new.pricing_mode = 'event' then
    new.event_package_id := 'birthday';
  end if;
  if new.distance_km is null then
    new.distance_km := 0;
  end if;
  if new.currency is null then
    new.currency := 'ZAR';
  end if;

  select coalesce(p.rating, 0)
    into rating
    from public.photographers p
   where p.id = new.photographer_id;

  if    rating >= 4.8 then rating_multiplier := 1.30;
  elsif rating >= 4.4 then rating_multiplier := 1.15;
  elsif rating >= 4.0 then rating_multiplier := 1.00;
  else                     rating_multiplier := 0.90;
  end if;

  if new.pricing_mode = 'event' then
    base_price := case new.event_package_id
      when 'wedding'   then 900
      when 'corporate' then 600
      else 250
    end;
  else
    base_price := base_per_photo * greatest(1, new.photo_count);
  end if;

  distance_fee            := distance_fee_per_km * greatest(0, new.distance_km);
  new.price_total         := round((base_price + distance_fee) * rating_multiplier * 100) / 100;
  new.commission_rate     := p_commission_rate;
  new.commission_amount   := round(new.price_total * p_commission_rate * 100) / 100;
  new.photographer_payout := round((new.price_total - new.commission_amount) * 100) / 100;

  return new;
end;
$$;


-- ============================================================
-- SECTION 4: FIX posts — Author ID Consolidation
-- ============================================================
DO $$
BEGIN
  -- Backfill author_id from user_id if user_id exists
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'user_id') THEN
    UPDATE public.posts SET author_id = coalesce(author_id, user_id) WHERE author_id IS NULL;
    ALTER TABLE public.posts DROP COLUMN user_id;
  END IF;

  -- Backfill author_id from profile_id if profile_id exists
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'profile_id') THEN
    UPDATE public.posts SET author_id = coalesce(author_id, profile_id) WHERE author_id IS NULL;
    ALTER TABLE public.posts DROP COLUMN profile_id;
  END IF;
END $$;

DROP INDEX IF EXISTS public.posts_profile_id_idx;

DROP POLICY IF EXISTS posts_delete_owner ON public.posts;
DROP POLICY IF EXISTS posts_update_owner ON public.posts;

CREATE POLICY posts_delete_owner ON public.posts
  FOR DELETE TO public
  USING (auth.uid() = author_id);

CREATE POLICY posts_update_owner ON public.posts
  FOR UPDATE TO public
  USING (auth.uid() = author_id);


-- ============================================================
-- SECTION 5: FIX messages — Body Consolidation
-- ============================================================
DO $$
BEGIN
  -- Migrate content if it exists
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'content') THEN
    UPDATE public.messages SET body = coalesce(nullif(trim(body), ''), content, '') WHERE body IS NULL OR body = '';
    ALTER TABLE public.messages DROP COLUMN content;
  END IF;

  -- Migrate text if it exists
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'text') THEN
    UPDATE public.messages SET body = coalesce(nullif(trim(body), ''), text, '') WHERE body IS NULL OR body = '';
    ALTER TABLE public.messages DROP COLUMN text;
  END IF;
END $$;


-- ============================================================
-- SECTION 6: RETIRE conversation_members
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'conversation_members') THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id, created_at)
    SELECT cm.conversation_id, cm.user_id, cm.created_at
    FROM public.conversation_members cm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = cm.conversation_id AND cp.user_id = cm.user_id
    )
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    DROP TABLE public.conversation_members;
  END IF;
END $$;


-- ============================================================
-- SECTION 7: ADMIN POLICIES & LOGGING
-- ============================================================
DROP POLICY IF EXISTS reviews_update_admin ON public.reviews;
CREATE POLICY reviews_update_admin ON public.reviews
  FOR UPDATE TO public
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- ============================================================
-- SECTION 8: ATTACH OWNERSHIP TRIGGER
-- ============================================================
DROP TRIGGER IF EXISTS ensure_conversation_owner_participant ON public.conversations;
CREATE TRIGGER ensure_conversation_owner_participant
  AFTER INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.ensure_conversation_owner_participant();
