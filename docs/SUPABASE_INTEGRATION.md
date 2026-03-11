# Supabase integration checklist

## 1. Environment

- `.env` in project root with:
  - `EXPO_PUBLIC_SUPABASE_URL` – your project URL
  - `EXPO_PUBLIC_SUPABASE_KEY` or `EXPO_PUBLIC_SUPABASE_ANON_KEY` – anon/public key

Expo loads these at build time; restart the dev server after changing `.env`.

## 2. Database migrations

Run in the Supabase SQL editor (in order):

1. **Reset schema**  
   `supabase/migrations/20260106114637_reset_schema.sql`  
   Creates: `profiles`, `photographers`, `conversations`, `messages`, `posts`, `comments`, `likes`, RLS, `recommend_posts`.

2. **Feed + profiles**  
   `supabase/migrations/20260203000000_posts_profiles_fk_and_feed_policies.sql`  
   - Links `posts.user_id` → `profiles.id` so the feed can embed author profiles.  
   - Allows public read on `profiles` so the feed works without login.

## 3. App ↔ DB alignment

| App usage | Table / column | Notes |
|-----------|----------------|--------|
| Auth, profile (role, verified) | `profiles` | Sign up upserts profile. |
| Photographers grid/detail | `photographers` + `profiles` | Join via `profiles(id)`. |
| Feed posts + author | `posts` + `profiles` | Join via `posts.user_id` → `profiles.id` (migration 2). |
| Realtime feed | `posts` | Enable Realtime for `posts` in Supabase Dashboard → Database → Replication. |
| Conversations list | `conversations` | Chat tab = ConversationsListScreen. |
| New conversation | `conversations` insert | Title, `created_by`, `last_message`, `last_message_at`. |
| Chat thread | `messages` | Load via `fetchMessagesForChat(chatId)`; insert via `sendMessage`. |
| Create post | `posts` insert | `user_id`, `caption`, `image_url`, `location`. |

## 4. Workflow

- **Home**: Photographers from Supabase (or fallback from initial state if empty).
- **Feed**: Posts + profiles from Supabase; pull-to-refresh; Realtime updates if enabled.
- **Chat**: Tab opens conversations list (Supabase); tap conversation → ChatThread loads messages from Supabase and sends via `sendMessage`.
- **Auth**: Sign in/up and profile upsert; session persisted.

If auth or API calls fail, confirm the anon key in `.env` matches **Supabase → Settings → API** (Project API keys). The `sb_publishable_*` value may be a custom key; if so, use the standard anon key from the dashboard.
