-- Bookings RLS: include model participants

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Clients can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Talent can update their booking status" ON public.bookings;
DROP POLICY IF EXISTS "bookings_select_participants" ON public.bookings;
DROP POLICY IF EXISTS "bookings_insert_client" ON public.bookings;
DROP POLICY IF EXISTS "bookings_update_talent" ON public.bookings;

CREATE POLICY "bookings_select_participants" ON public.bookings
  FOR SELECT TO authenticated
  USING (
    auth.uid() = client_id
    OR auth.uid() = photographer_id
    OR auth.uid() = model_id
  );

CREATE POLICY "bookings_insert_client" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = client_id);

CREATE POLICY "bookings_update_talent" ON public.bookings
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = photographer_id
    OR auth.uid() = model_id
  )
  WITH CHECK (
    auth.uid() = photographer_id
    OR auth.uid() = model_id
  );
