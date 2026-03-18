-- Reconcile tables referenced by frontend that may be missing if older
-- world_class_features migration was repaired in history but not fully applied.

CREATE TABLE IF NOT EXISTS public.crash_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  error_message text NOT NULL,
  error_stack text,
  screen text,
  context jsonb DEFAULT '{}',
  platform text,
  app_version text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('❤','😂','😮','😢','👏','🔥','💯','😍')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS public.post_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_crash_logs_created ON public.crash_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON public.message_reactions(message_id);

ALTER TABLE public.crash_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_bookmarks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'crash_logs' AND policyname = 'insert crash logs'
  ) THEN
    CREATE POLICY "insert crash logs" ON public.crash_logs FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'crash_logs' AND policyname = 'admin reads crash logs'
  ) THEN
    CREATE POLICY "admin reads crash logs" ON public.crash_logs
    FOR SELECT USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'message_reactions' AND policyname = 'participants can manage reactions'
  ) THEN
    CREATE POLICY "participants can manage reactions" ON public.message_reactions
    FOR ALL USING (
      EXISTS (
        SELECT 1
        FROM public.conversation_participants cp
        JOIN public.messages m ON m.chat_id = cp.conversation_id
        WHERE m.id = message_id AND cp.user_id = auth.uid()
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'post_bookmarks' AND policyname = 'own bookmarks'
  ) THEN
    CREATE POLICY "own bookmarks" ON public.post_bookmarks
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
