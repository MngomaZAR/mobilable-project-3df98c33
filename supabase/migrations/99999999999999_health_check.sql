-- ============================================================
-- PAPZII SCHEMA HEALTH CHECK
-- Run this script in the Supabase SQL Editor to verify 
-- that all remediations and fixes have been correctly applied.
-- ============================================================

SELECT
  'broken functions gone'            AS check_name,
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('ensure_message_booking','sync_chat_metadata','handle_successful_payment','process_payment_transaction','handle_chats_updated_at')
  ) THEN '✅ DONE' ELSE '❌ NOT RUN' END AS status

UNION ALL SELECT 'bookings uses start_datetime',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'start_datetime'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'start_time'
  ) THEN '✅ DONE' ELSE '❌ NOT RUN' END

UNION ALL SELECT 'posts uses author_id only',
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name IN ('user_id','profile_id')
  ) THEN '✅ DONE' ELSE '❌ NOT RUN' END

UNION ALL SELECT 'messages body only',
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name IN ('content','text')
  ) THEN '✅ DONE' ELSE '❌ NOT RUN' END

UNION ALL SELECT 'conversation_members retired',
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'conversation_members'
  ) THEN '✅ DONE' ELSE '❌ NOT RUN' END

UNION ALL SELECT 'reviews WITH CHECK',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'reviews' AND policyname = 'reviews_update_client_pending' AND with_check IS NOT NULL
  ) THEN '✅ DONE' ELSE '❌ NOT RUN' END

UNION ALL SELECT 'user_hats table + policies',
  CASE WHEN (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'user_hats') = 3
  THEN '✅ DONE' ELSE '❌ NOT RUN' END;
