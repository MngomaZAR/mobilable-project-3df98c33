# Quick Start Checklist ✅

## ✅ Step 1: Run Migrations (5 minutes)

### Migration 1: Reset Schema
1. Open Supabase Dashboard → SQL Editor
2. Copy **ALL** from: `supabase/migrations/20260106114637_reset_schema.sql`
3. Paste → Run ✅

### Migration 2: Feed Integration  
1. New query in SQL Editor
2. Copy **ALL** from: `supabase/migrations/20260203000000_posts_profiles_fk_and_feed_policies.sql`
3. Paste → Run ✅

### Verify (Optional)
Run: `supabase/migrations/VERIFY_MIGRATIONS.sql` to check everything worked.

---

## ✅ Step 2: Enable Realtime (30 seconds)

1. Supabase Dashboard → **Database** → **Replication**
2. Find **`posts`** table
3. Toggle **"Enable Realtime"** → **ON** ✅

---

## ✅ Step 3: Check API Key

Your `.env` currently has:
```
EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_xUwNDTD_7JYmAJWieIm-ug_nICOE4as
```

**⚠️ This looks like a custom key format, not the standard Supabase anon key.**

**To fix:**
1. Go to Supabase Dashboard → **Settings** → **API**
2. Copy the **`anon` `public`** key (starts with `eyJhbGciOiJ...`)
3. Update `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_KEY=<paste-anon-key-here>
   ```
   OR
   ```
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<paste-anon-key-here>
   ```

---

## ✅ Step 4: Start App

```bash
cd c:\Users\27790\Desktop\papz_launch\mobilable-project-3df98c33
npm start
```

Then:
- Press `w` for web
- Press `a` for Android
- Press `i` for iOS
- Scan QR code for Expo Go

---

## ✅ Step 5: Test

1. **Home tab:** Should load (empty if no photographers yet)
2. **Feed tab:** Should load (empty if no posts yet)
3. **Chat tab:** Should show conversations list (empty if none yet)
4. **Settings → Auth:** Try sign up/in

---

## 🐛 If Something Fails

### Auth errors?
- Check `.env` has correct `anon` key from Supabase Dashboard
- Restart Expo: `npm start` (or `npx expo start --clear`)

### Feed shows no posts?
- Check Migration #2 ran successfully
- Verify FK exists: Run `VERIFY_MIGRATIONS.sql`

### Chat doesn't load?
- Check `conversations` table exists (Migration #1)
- Check you're signed in (conversations require auth)

---

## 📚 Full Docs

- **Detailed migration guide:** `MIGRATION_GUIDE.md`
- **Integration docs:** `docs/SUPABASE_INTEGRATION.md`
- **Verification queries:** `supabase/migrations/VERIFY_MIGRATIONS.sql`
