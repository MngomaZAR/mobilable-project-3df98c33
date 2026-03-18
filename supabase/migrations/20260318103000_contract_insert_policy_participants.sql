-- Allow any booking participant (creator/client/model) to generate required legal contracts.
-- This prevents empty legal-document screens when non-creator users open legal flows first.

DROP POLICY IF EXISTS "Photographers can create contracts" ON public.contracts;
DROP POLICY IF EXISTS "Participants can create contracts" ON public.contracts;

CREATE POLICY "Participants can create contracts" ON public.contracts
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = booking_id
        AND (
          auth.uid() = b.client_id OR
          auth.uid() = b.photographer_id OR
          auth.uid() = b.model_id
        )
    )
  );
