-- Verification queries for migrations
-- Run these in Supabase SQL Editor after running both migrations

-- 1. Check all tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Expected: comments, conversations, likes, messages, photographers, posts, profiles

-- 2. Verify posts -> profiles foreign key
SELECT 
  tc.constraint_name, 
  tc.table_name, 
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'posts'
  AND kcu.column_name = 'user_id';

-- Expected: posts_user_id_fkey referencing profiles.id

-- 3. Verify profiles public read policy
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies 
WHERE tablename = 'profiles'
ORDER BY policyname;

-- Expected: profiles_select_public with cmd = 'SELECT' and qual = '(true)'

-- 4. Check recommend_posts function exists
SELECT 
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'recommend_posts';

-- Expected: recommend_posts function with limit_count, offset_count parameters

-- 5. Verify RLS is enabled on key tables
SELECT 
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'photographers', 'posts', 'conversations', 'messages')
ORDER BY tablename;

-- Expected: All should show rls_enabled = true
