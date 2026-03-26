-- Enable realtime on location tracking and photographers updates (idempotent)
DO $$
BEGIN
  -- Ensure profiles have an is_online flag for map/availability gating
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'is_online'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN is_online boolean DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_profiles_online ON public.profiles(is_online) WHERE is_online = true;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'location_tracks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.location_tracks;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'photographers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.photographers;
  END IF;
END $$;
