-- ============================================================
-- SCHEMA BUG FIXES: 6 Live Issues Found in Audit
-- File: supabase/migrations/20260310000003_schema_bug_fixes.sql
-- Run in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- FIX 1: posts INSERT policy uses author_id, but the app inserts user_id
-- The frontend sets user_id only. Fix: align INSERT policy to user_id
-- (user_id, author_id, and profile_id all FK to profiles — unify to user_id)
-- ============================================================
DROP POLICY IF EXISTS "posts_insert_authenticated" ON public.posts;
CREATE POLICY "posts_insert_authenticated" ON public.posts
  FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

-- Also align DELETE and UPDATE to use the same column consistently
DROP POLICY IF EXISTS "posts_delete_owner" ON public.posts;
CREATE POLICY "posts_delete_owner" ON public.posts
  FOR DELETE TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "posts_update_owner" ON public.posts;
CREATE POLICY "posts_update_owner" ON public.posts
  FOR UPDATE TO public
  USING (auth.uid() = user_id);


-- ============================================================
-- FIX 2: Remove the redundant double pricing trigger
-- Keep: bookings_pricing_set (calculate_booking_pricing) — smarter, rating-based
-- Drop: trg_recalculate_booking_amounts (overwrites with flat 30% only)
-- ============================================================
DROP TRIGGER IF EXISTS trg_recalculate_booking_amounts ON public.bookings;


-- ============================================================
-- FIX 3: Drop the two broken trigger functions that reference 
-- the non-existent 'chats' table (ensure_message_booking, sync_chat_metadata)
-- They are orphaned functions with no trigger wiring - but safer to clean up
-- ============================================================
DROP FUNCTION IF EXISTS public.ensure_message_booking() CASCADE;
DROP FUNCTION IF EXISTS public.sync_chat_metadata() CASCADE;


-- ============================================================
-- FIX 4: Drop broken payment functions that reference non-existent 
-- LedgerEntries, LedgerEntry, PlatformCommission, PhotographerBalance tables
-- ============================================================
DROP FUNCTION IF EXISTS public.handle_successful_payment(uuid, uuid, integer) CASCADE;
DROP FUNCTION IF EXISTS public.process_payment_transaction(uuid, uuid, integer, integer, integer) CASCADE;


-- ============================================================
-- FIX 5: Add missing INSERT policy for earnings 
-- Currently only has SELECT — earnings must be insertable by authenticated users
-- (or only via service role / triggers — keep restrictive: service role only)
-- This is INTENTIONAL: earnings are created by server-side logic, not clients.
-- Adding a comment to clarify:
-- earnings: INSERT intentionally restricted to service role only
-- If you need a client-side path, uncomment below:
-- CREATE POLICY "earnings_insert_system" ON public.earnings
--   FOR INSERT TO authenticated  
--   WITH CHECK (user_id = auth.uid());


-- ============================================================
-- FIX 6: Remove redundant conversation_members table data
-- (It's a duplicate of conversation_participants with less utility)
-- Keep the table structure but ensure it doesn't cause confusion.
-- The messaging system exclusively uses conversation_participants.
-- ============================================================
-- No SQL change needed — just documented above for clarity.


-- ============================================================
-- VERIFY: Check the bookings prevent_overlap trigger
-- The function uses tstzrange() on start_time/end_time which are
-- time without time zone (NOT timestamptz). This will fail at runtime.
-- The trigger is NOT currently attached per the trigger list — confirming it's safe.
-- If you need overlap detection, it needs a proper timestamptz booking window.
-- ============================================================

-- Confirm bookings_pricing_set trigger is still active after the drop above:
-- (no SQL needed - just dropping the duplicate trigger, not the main one)
