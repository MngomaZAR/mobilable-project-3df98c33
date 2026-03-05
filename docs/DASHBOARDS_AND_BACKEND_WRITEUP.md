# Papzi: Dashboards, Backend & Operational Write-Up

This document explains what each dashboard and role does, how the backend and app connect, why certain features depend on migrations and environment, and what you need for full functionality (including on iPhone).

---

## 1. Environment & Why We Kept Hitting the Same Error

### 1.1 The “trackEvent” / “Something went wrong” loop

- **Cause:** In `AppDataContext.tsx`, several `useCallback` hooks (`createBooking`, `sendMessage`, `toggleLike`, `addComment`, `requestDataDeletion`) had **`trackEvent` in their dependency arrays**.
- **Problem:** In JavaScript, `const trackEvent = useCallback(...)` is not initialized until that line runs. Any callback declared **earlier** in the same scope that lists `trackEvent` in its deps is in the **Temporal Dead Zone**: it “sees” the name before it’s defined, so you get `ReferenceError: Cannot access 'trackEvent' before initialization`.
- **Fix:** Define `trackEvent` (and `refreshPostMetrics`, which nothing depends on earlier) **above** every callback that references them. No duplicate declarations—only one `const trackEvent` in the file.
- **Web vs native:** On web, `ErrorUtils` doesn’t exist. The global error handler in `App.tsx` must guard with `if (typeof ErrorUtils === 'undefined') return;` so it only runs where `ErrorUtils` exists (React Native), avoiding a second crash on web.

### 1.2 Interdependencies that make the app sensitive

- **Auth → profile → role:** `currentUser` comes from Supabase Auth + `profiles`. Role (`client` | `photographer` | `admin`) drives which dashboard links appear in Settings and what RLS allows.
- **Supabase client:** One shared client in `src/config/supabaseClient.ts`. Uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` (or `EXPO_PUBLIC_SUPABASE_ANON_KEY`). If either is missing or wrong, all API calls fail.
- **Migrations order:** Schema and RLS are built by running migrations in timestamp order. Missing or reverted migrations (e.g. conversation insert policy fix) cause specific features to break (e.g. “New Chat”).
- **Session:** Supabase Auth persists session and refreshes tokens. If the session is lost or not yet loaded when a screen runs, `auth.uid()` is null and RLS can block inserts (conversations, messages, etc.).

---

## 2. Backend Overview (Supabase)

### 2.1 Core tables (from migrations)

| Table | Purpose |
|-------|--------|
| `profiles` | User profile (role, verified, name, avatar, city). FK to `auth.users`. |
| `photographers` | Photographer profile (rating, location, lat/lng, price_range, is_available, etc.). FK to `profiles`. |
| `posts` | Social feed posts (user_id, caption, image_url, likes_count, comment_count, location). |
| `bookings` | Booking requests (client_id, photographer_id, requested_date, package, status, pricing fields, user_latitude, user_longitude). |
| `payments` | Payment records (booking_id, status, amount, etc.). |
| `conversations` | Chat thread (title, created_by, last_message, last_message_at, optional booking_id). |
| `conversation_participants` | Who is in each conversation (conversation_id, user_id, last_read_at). |
| `messages` | Chat messages (chat_id, sender_id, body, created_at). |
| `post_likes` | Like a post (post_id, user_id). |
| `post_comments` | Comment on a post (post_id, user_id, body). |
| `support_tickets` | Support requests (created_by, subject, category, description, status). |
| `reports` | Moderation reports (target_type, target_id, reason, details, status). |
| `account_deletion_requests` | Deletion requests (created_by, reason, status). |
| `analytics_events` | App events (name, created_by, metadata). |
| `error_reports` | Crash/error logs (message, stack, context, created_by). |

### 2.2 RLS and “New Chat”

- **Conversations insert:** Migration `20260203030000_fix_conversations_insert_policy.sql` replaces the strict “creator only” policy with: **any authenticated user** can insert (`auth.uid() is not null`). The app sends `created_by: currentUser.id` when creating a conversation.
- **If “New Chat” still fails:**  
  1. Ensure **all migrations** are applied (especially `20260203030000`).  
  2. Ensure the Supabase client has a **valid session** when the user taps “New Chat” (`auth.uid()` must be set).  
  3. Check Supabase logs for the exact RLS denial.

### 2.3 Key migrations (order matters)

- `20260106114637_reset_schema.sql` – Base tables and initial RLS.
- `20260203020000_conversation_participants_and_rls.sql` – Participants, messages/conversations RLS.
- `20260203030000_fix_conversations_insert_policy.sql` – Relaxes conversation insert so “New Chat” works for any authenticated user.
- `20260203090000_social_support_moderation.sql` – post_likes, post_comments, support_tickets, reports, account_deletion_requests, analytics_events, error_reports and their RLS.

---

## 3. User (Client) Dashboard / Flow

**Entry:** Logged-in user with role `client` (default). No separate “User dashboard” screen; the main experience is the **tab navigator**: Home, Bookings, Feed, Chat, Map, Settings.

### 3.1 Home

- **File:** `src/screens/HomeScreen.tsx`
- **Data:** `state.photographers` from `AppDataContext` (fetched from `photographers` + `profiles`).
- **Actions:** Filter by category/price/location, sort; open **Profile** (photographer); start **BookingForm** (photographerId).

### 3.2 Bookings

- **File:** `src/screens/BookingsScreen.tsx`
- **Data:** `state.bookings` (Supabase `bookings`).
- **Actions:** Open **BookingDetail** for a booking; from there, pay (**Payment**) or open **ChatThread** via `getOrCreateBookingConversation(bookingId, photographerId)`.

### 3.3 Feed

- **File:** `src/screens/FeedScreen.tsx` → `src/components/SocialFeed.tsx`
- **Data:** Posts from Supabase (`posts` + author via `profiles`), likes from `post_likes`, counts from DB.
- **Actions:** Like (`toggleLike`), comment (`addComment`), open **PostDetail**, **CreatePost**, **UserProfile**.

### 3.4 Chat

- **File:** `src/screens/ConversationsListScreen.tsx` (Chat tab)
- **Data:** Conversations where the user is a participant (`conversation_participants` + `conversations`).
- **Actions:** **New Chat** (insert `conversations` + one `conversation_participants` row, then navigate to **ChatThread**); open existing **ChatThread**.
- **Booking-linked chat:** From **BookingDetail**, “Message” uses `getOrCreateBookingConversation` (creates conversation with `booking_id` and adds client + photographer as participants), then **ChatThread**.

### 3.5 Map

- **File:** `src/screens/MapScreen.tsx`
- **Data:** `state.photographers`, optional user location; recommendation engine uses distance, rating, availability.
- **Actions:** Open **Profile**, **BookingForm**.

### 3.6 Settings

- **File:** `src/screens/SettingsScreen.tsx`
- **Actions:** Support, Privacy policy, Terms, Account & Auth, **Photographer dashboard** (only if `currentUser.role === 'photographer'`), **Admin dashboard** (only if `currentUser.role === 'admin'`), Compliance, Account deletion, Reset local data.
- **Note:** When already logged in, "Account & Auth" navigates to `Auth`; that screen is only in the unauthenticated stack. To see the sign-in/sign-up screen, sign out first (e.g. from a dedicated Sign out action), which sets `currentUser` to null and shows the Auth stack.

---

## 4. Photographer Dashboard

- **File:** `src/screens/PhotographerDashboardScreen.tsx`
- **Entry:** Settings → “Photographer dashboard” (only when `currentUser.role === 'photographer'`).
- **Data:** `state.bookings`, `state.photographers`, `state.messages`; pricing from `utils/pricing`; heatmap from bookings with `userLatitude` / `userLongitude`.
- **Features:**
  - Active jobs count (pending bookings).
  - Inbox (message count).
  - Pricing tier and estimated rate/payout.
  - Heat map (MapPreview) of recent booking locations.
  - Live route (MapTracker) for an active booking.
  - Advance booking status (pending → accepted → completed → reviewed).
  - Request queue (pending bookings) with links to **BookingDetail** and **Chat**.

---

## 5. Admin Dashboard

- **File:** `src/screens/AdminDashboardScreen.tsx`
- **Entry:** Settings → “Admin dashboard” (only when `currentUser.role === 'admin'`).
- **Data:** Counts from `profiles`, `photographers`, `posts`, `bookings`, `payments`, `conversations`, `messages`; support_tickets, reports, recent payments, recent bookings (last 6 each).
- **Features:**
  - Platform health stats (table counts).
  - Sample pricing (paparazzi + event) for a sample photographer.
  - Support tickets list + status update.
  - Reports list + status update.
  - Recent bookings and payments (formatCurrency).

**Note:** Admin RLS is defined in `20260203090000_social_support_moderation.sql` (e.g. admin can select/update support_tickets and reports). The app does not enforce admin role in the API; RLS does. Ensure `profiles.role = 'admin'` in the DB for admin users.

---

## 6. Operational / Performance: Why Something Might Not Work

### 6.1 “I can’t start a new chat”

- **RLS:** Migration `20260203030000` must be applied so conversation insert allows any authenticated user.
- **Session:** Supabase Auth session must be valid. If the app uses a stale or missing session, `auth.uid()` is null and insert is denied.
- **Flow:** ConversationsListScreen inserts into `conversations` (title, created_by, last_message, last_message_at) then one row in `conversation_participants` (conversation_id, user_id). Both require `auth.uid()` to match the signed-in user.

### 6.2 “Features don’t work on my iPhone”

- **Build:** Use the same env (e.g. `.env` or EAS env) so `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` are present in the native build (Expo injects these at build time).
- **Session persistence:** Supabase client uses `persistSession: true` and `autoRefreshToken: true`. On iOS, ensure you’re not clearing storage or logging out inadvertently; otherwise `auth.uid()` can be null and RLS will block writes.
- **Permissions:** Notifications (expo-notifications), location (if used for Map/booking), and any native capabilities must be requested and granted on device.
- **Network:** Supabase and PayFast (if used) must be reachable from the device (no firewall blocking, correct URLs).
- **Migrations:** The same migrations must be applied on the Supabase project the app points to; otherwise tables or RLS may be missing and features will fail.

### 6.3 What’s needed to see all features working

1. **Backend:** All migrations applied on the target Supabase project (reset_schema through social_support_moderation and any later ones).
2. **Env:** `.env` (or EAS env) with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` (or anon key) set correctly.
3. **Auth:** At least one verified user; one profile with `role = 'photographer'` (and linked `photographers` row if needed); one with `role = 'admin'` for admin dashboard.
4. **Chat:** After the conversation-insert fix migration, “New Chat” works for any logged-in user; booking-linked chat works from BookingDetail via `getOrCreateBookingConversation`.
5. **Payments:** PayFast Edge Function deployed and ITN/notify URL configured; booking and payment flows use the same Supabase project and env.

---

## 7. File Reference (where things live)

| Area | Path |
|------|------|
| App entry, error handler | `App.tsx` |
| Global state, Supabase calls | `src/store/AppDataContext.tsx` |
| Supabase client | `src/config/supabaseClient.ts` |
| Navigation | `src/navigation/MainNavigator.tsx`, `types.ts` |
| User flows | `src/screens/HomeScreen.tsx`, BookingsScreen, FeedScreen, ConversationsListScreen, MapScreen, SettingsScreen |
| Booking → Chat | `src/screens/BookingDetailScreen.tsx` (getOrCreateBookingConversation → ChatThread) |
| Photographer dashboard | `src/screens/PhotographerDashboardScreen.tsx` |
| Admin dashboard | `src/screens/AdminDashboardScreen.tsx` |
| Migrations | `supabase/migrations/` (run in order) |
| PayFast | `supabase/functions/payfast-handler/` |

---

## 8. Summary

- **trackEvent crash:** Fixed by defining `trackEvent` (and `refreshPostMetrics`) above all callbacks that depend on them in `AppDataContext.tsx`, and by guarding the global error handler in `App.tsx` on web.
- **New Chat:** Depends on migration `20260203030000` and a valid Supabase session so `auth.uid()` is set.
- **User experience:** Tabs (Home, Bookings, Feed, Chat, Map, Settings); photographer and admin dashboards are reached from Settings by role.
- **Backend:** Supabase tables and RLS from migrations; one client; session and env must be correct for all features.
- **iPhone / devices:** Same env, migrations, and session persistence; permissions and network must allow Supabase (and PayFast if used). No separate “mobile” backend—same project and migrations everywhere.
