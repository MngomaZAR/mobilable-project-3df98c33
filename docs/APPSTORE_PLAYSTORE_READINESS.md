# Papzi App Store and Play Store Readiness

This checklist tracks the current release-critical implementation status for Papzi.

## Completed in this release pass

- Role-based app experience:
  - `client` tabs: Home, Bookings, Feed, Chat, Map, Settings
  - `photographer` tabs: Requests, Earnings, Portfolio, Calendar, Chat, Map, Settings
  - `admin` tabs: AdminOps, Chat, Settings
- Social chat without bookings:
  - Users can start conversations directly from profile screens.
  - Conversations are created in `public.conversations` and linked through `public.conversation_participants`.
- Feed data wiring:
  - Feed reads posts from `public.posts`.
  - Like state reads from `public.post_likes`.
  - Comments read from `public.post_comments`.
- Mobile media behavior:
  - Create post upload flow kept active (`post-images` storage path).
  - Post detail image supports fullscreen zoom and pinch-to-zoom behavior.
- Map improvements:
  - Floating search bar and map-first layout.
  - Zoom and map gesture controls enabled in native map preview.
- Currency localization:
  - Currency formatting now defaults to South African Rand (`ZAR`, `R`) app-wide.
- Navigation polish:
  - Back button text configured to show `Back` (instead of route-name label like `Root`).
- Runtime warning fix:
  - Duplicate key issue in booking weekdays fixed by unique day+index keys.

## Supabase checks (live project)

- Required social tables present and RLS-enabled:
  - `posts`, `post_likes`, `post_comments`, `conversations`, `conversation_participants`, `messages`
- Quick row-count sanity check succeeded:
  - `posts_count`, `likes_count`, `comments_count` query executed successfully.

## Store submission checklist (next actions)

- Configure OAuth providers in Supabase Auth:
  - Enable Google and Apple
  - Add redirect URL: `papzi://auth/callback`
- Replace any remaining placeholder legal text with production legal copy.
- Verify release builds on:
  - iOS TestFlight
  - Android internal testing track
- Validate critical flows on real devices:
  - signup/login (email + OAuth)
  - create booking
  - chat (with and without booking)
  - create post upload
  - feed refresh/likes/comments
  - map location and search behavior
- Confirm production env variables in build pipeline:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_KEY` (or anon equivalent)
  - `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

