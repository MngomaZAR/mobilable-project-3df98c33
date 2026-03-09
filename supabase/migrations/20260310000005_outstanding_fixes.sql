-- 1. FIX: reviews_update_client_pending — add WITH CHECK
DROP POLICY IF EXISTS reviews_update_client_pending ON public.reviews;
CREATE POLICY reviews_update_client_pending ON public.reviews
  FOR UPDATE TO public
  USING (auth.uid() = client_id AND moderation_status = 'pending')
  WITH CHECK (moderation_status = 'pending');

-- 2. FIX: user_hats ownership table
CREATE TABLE IF NOT EXISTS public.user_hats (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hat_id      uuid NOT NULL REFERENCES public.hats(id) ON DELETE CASCADE,
  equipped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hat_id)
);

ALTER TABLE public.user_hats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_hats_select_self ON public.user_hats;
CREATE POLICY user_hats_select_self ON public.user_hats
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_hats_insert_self ON public.user_hats;
CREATE POLICY user_hats_insert_self ON public.user_hats
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_hats_delete_self ON public.user_hats;
CREATE POLICY user_hats_delete_self ON public.user_hats
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.user_hats IS
  'Tracks which cosmetic hats a user owns and has equipped.';
