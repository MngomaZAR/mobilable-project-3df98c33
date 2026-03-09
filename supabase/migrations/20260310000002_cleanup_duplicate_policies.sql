-- ============================================================
-- CLEANUP: Remove duplicate policies created by multiple migrations
-- Run after 20260310000001_definitive_rls_fix.sql
-- ============================================================

-- posts has two SELECT policies (posts_public_read + posts_select_public)
DROP POLICY IF EXISTS "posts_select_public" ON public.posts;
-- Keep "posts_public_read" as the canonical one

-- profiles has three SELECT policies (Profiles public read + profiles_select_public + profiles_public_read)
DROP POLICY IF EXISTS "Profiles public read" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;
-- Keep "profiles_public_read" as the canonical one

-- tips has two INSERT and two SELECT policies
DROP POLICY IF EXISTS "tips_insert_sender" ON public.tips;
DROP POLICY IF EXISTS "tips_select_participants" ON public.tips;
-- Keep "tips_insert" (authenticated) and "tips_select" (authenticated)

-- subscriptions has three SELECT policies
DROP POLICY IF EXISTS "subscriptions_select_participants" ON public.subscriptions;
-- Keep "subscriptions_select" (authenticated) and "subscriptions_insert" (authenticated)
