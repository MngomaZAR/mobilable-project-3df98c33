CREATE TABLE IF NOT EXISTS public.payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  account_holder text NOT NULL,
  account_number text NOT NULL,
  account_type text DEFAULT 'cheque' CHECK (account_type IN ('cheque', 'savings', 'current')),
  branch_code text,
  is_default boolean DEFAULT false,
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payout_methods'
      AND policyname = 'own payout methods'
  ) THEN
    CREATE POLICY "own payout methods"
      ON public.payout_methods
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
