# Supabase Migration & Setup Guide

## Option A: Run migrations from the terminal (recommended)

1. **One-time:** Log in and link to your project:
   ```bash
   npm run supabase:login
   npm run supabase:link
   ```
   When prompted, use your **database password** from Supabase Dashboard → **Settings → Database**.

2. **Apply all migrations (including Realtime for `posts`):**
   ```bash
   npm run db:migrate
   ```
   This runs all migrations in order and enables Realtime for the `posts` table.

See **scripts/run-migrations.md** for more detail and troubleshooting.

---

## Option B: Run migrations in Supabase SQL Editor

## Step 1: Access Supabase SQL Editor

1. Go to https://supabase.com/dashboard
2. Select your project: **luxppjfrlsnvtslundfz**
3. Navigate to **SQL Editor** (left sidebar)

## Step 2: Run Migration #1 (Reset Schema)

**⚠️ WARNING:** This migration will **DROP ALL EXISTING TABLES** in the `public` schema (except `schema_migrations`). Only run this if you're starting fresh or have backed up your data.

1. In SQL Editor, click **"New query"**
2. Copy the **ENTIRE** contents of:
   ```
   supabase/migrations/20260106114637_reset_schema.sql
   ```
3. Paste into the SQL Editor
4. Click **"Run"** (or press `Ctrl+Enter` / `Cmd+Enter`)
5. Wait for success message: ✅ "Success. No rows returned"

**Expected result:** Creates tables: `profiles`, `photographers`, `conversations`, `messages`, `posts`, `comments`, `likes`, plus RLS policies and the `recommend_posts` function.

## Step 3: Run Migration #2 (Feed Integration)

1. In SQL Editor, click **"New query"** (or clear the previous one)
2. Copy the **ENTIRE** contents of:
   ```
   supabase/migrations/20260203000000_posts_profiles_fk_and_feed_policies.sql
   ```
3. Paste into the SQL Editor
4. Click **"Run"**
5. Wait for success message: ✅ "Success. No rows returned"

**Expected result:** 
- Links `posts.user_id` → `profiles.id` (enables feed to embed author profiles)
- Allows public read on `profiles` (feed works without login)

## Step 3b: Enable Realtime for Posts (via SQL)

1. In SQL Editor, **New query**
2. Copy the **ENTIRE** contents of:
   ```
   supabase/migrations/20260203000001_enable_realtime_posts.sql
   ```
3. Paste → **Run** ✅

**Expected result:** Adds `posts` to the `supabase_realtime` publication so the feed updates live.

(Alternatively use Step 4 below via the Dashboard.)

## Step 4: Enable Realtime for Posts (Alternative: via Dashboard)

1. In Supabase Dashboard, go to **Database** → **Replication** (left sidebar)
2. Find the **`posts`** table in the list
3. Toggle **"Enable Realtime"** to **ON** for `posts`
4. Wait a few seconds for the change to apply

**Why:** This allows the feed to update live when new posts are created/updated/deleted, without requiring a manual refresh.

## Step 5: Verify Your API Key

1. In Supabase Dashboard, go to **Settings** → **API** (left sidebar)
2. Under **"Project API keys"**, find the **`anon` `public`** key
3. It should look like a long token string from Supabase (do not paste or commit it to source control).
4. Compare with your `.env` file:
   ```
   EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_xUwNDTD_7JYmAJWieIm-ug_nICOE4as
   ```

**If they don't match:**
- The `sb_publishable_*` key might be a custom key format
- **Try using the `anon` key from the dashboard instead:**
  - Copy the `anon` `public` key from Settings → API
  - Update `.env`:
    ```
    EXPO_PUBLIC_SUPABASE_KEY=<paste-anon-key-here>
    ```
  - Or use:
    ```
    EXPO_PUBLIC_SUPABASE_ANON_KEY=<paste-anon-key-here>
    ```

## Step 6: Verify Tables Were Created

Run this query in SQL Editor to verify:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

**Expected tables:**
- `comments`
- `conversations`
- `likes`
- `messages`
- `photographers`
- `posts`
- `profiles`

## Step 7: Verify Foreign Key Was Created

Run this query to verify the `posts` → `profiles` FK:

```sql
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
```

**Expected:** Should show `posts_user_id_fkey` referencing `profiles.id`

## Step 8: Verify RLS Policies

Run this query to verify profiles policies:

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies 
WHERE tablename = 'profiles';
```

**Expected:** Should show `profiles_select_public` with `cmd = 'SELECT'` and `qual = '(true)'`

## Troubleshooting

### Error: "relation already exists"
- The migration was already run. Skip Migration #1 and only run Migration #2.

### Error: "permission denied"
- Ensure you're running queries as a database admin (default in SQL Editor).

### Error: "foreign key constraint violation"
- Migration #2 might fail if there are existing `posts` rows with `user_id` values that don't exist in `profiles`.
- Solution: Either delete orphaned posts, or create profiles for those users first.

### Auth/API calls fail after migrations
- Double-check `.env` has the correct `anon` key from Settings → API
- Restart your Expo dev server: `npm start` (or stop and restart)
- Clear Metro cache: `npx expo start --clear`

## Next Steps

After migrations are complete:
1. Restart your Expo dev server: `npm start`
2. Test the app:
   - **Home tab:** Should load photographers from Supabase (or show empty if none exist)
   - **Feed tab:** Should load posts + author profiles (or show empty if none exist)
   - **Chat tab:** Should show conversations list (or show empty if none exist)
   - **Auth:** Sign up/in should create/update profiles

## Need Help?

- Check `docs/SUPABASE_INTEGRATION.md` for detailed integration docs
- Verify `.env` file exists and has correct values
- Check Supabase Dashboard → Logs for API errors
