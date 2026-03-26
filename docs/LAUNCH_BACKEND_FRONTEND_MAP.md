# PAPZI Launch Backend-Frontend Map

Date: 2026-03-24  
Project ref: `mizdvqhvspkjayffaqqd` (`PAPZII`, `ACTIVE_HEALTHY`)

## 1) Live validation status

- `node scripts/live-smoke-auth.mjs`: **PASS** (13/13)
- `node scripts/e2e-full-app-sweep.mjs`: **PASS** (80/80, 2 expected role warnings)
- `npm run check:launch`: **PASS**
  - typecheck
  - lint
  - tests
  - source/connectivity audit
  - dashboard route audit
  - web export build

## 2) Backend architecture snapshot

## Supabase schema/security
- Total tables (`public + storage`): `70`
- Public tables: `62`
- Storage tables: `8`
- RLS-enabled tables: `68`
- Policies: `154`
- Policy-covered tables: `61`

## Public tables without RLS/policy (review required)
- `public.recommendation_weights`
- `public.recommendation_weight_history`

These appear to be internal ranking weight tables. If they should not be directly readable/writable outside trusted paths, enable RLS and explicit policies.

## Storage buckets
- `avatars` (public, image only, 5MB)
- `chat-media` (private, image only, 10MB)
- `media` (private, image/video, 50MB)
- `post-images` (public, image only, 10MB)

## Edge functions deployed (21)
- `payfast-sign`
- `payfast-itn`
- `media-sign-url`
- `push-dispatcher`
- `payfast-handler`
- `conversation-start`
- `chat-messages`
- `livekit-token`
- `escrow-release`
- `dispatch-create`
- `dispatch-respond`
- `dispatch-state`
- `eta`
- `status-leaderboard`
- `compliance-consent`
- `for-you-ranking`
- `heatmap`
- `send-app-email`
- `admin-review`
- `payout-methods`
- `recommendation-events`

## 3) Frontend contract coverage

Frontend references:
- Supabase tables: `40`
- Edge functions: `17`

Contract audits:
- All referenced tables found in live DB
- All referenced functions deployed
- All role dashboards mapped with valid navigation targets

## 4) Role dashboards and critical flows

Validated in live sweep:
- Client booking creation/status progression
- Dispatch create/respond/state flow with idempotency checks
- ETA snapshots and confidence updates
- Escrow release flow
- PPV lock/unlock entitlement flow
- Payout methods flow
- Admin moderation queue + triage action flow

Expected warnings from contract probe:
- `admin-review`: returns `403` for non-admin token (correct)
- `livekit-token`: returns `403` outside client<->model policy (correct)

## 5) UI alignment changes completed

Updated tracking screen to match launch reference behavior/style:
- File: `src/screens/BookingTrackingScreen.tsx`
- Replaced basic card layout with:
  - full-screen map
  - live route line between provider/client
  - animated live pin pulse
  - floating bottom action panel with timer, chat, and cancel
  - dark/light visual treatment aligned to the visual direction
  - realtime booking/provider updates preserved via Supabase subscriptions

## 6) Remaining launch hardening

1. Physical-device smoke per platform (iOS + Android) against production backend keys.
2. Store submission final verification (privacy/data safety/support links/screenshots).

## 7) Completed after initial report

- RLS enabled on:
  - `public.recommendation_weights`
  - `public.recommendation_weight_history`
- LiveKit production secrets verified:
  - missing-auth probe returns `401` (not secret-missing `500`)
  - valid client->model call returns `200` token + room payload
  - resolved production URL: `wss://papzii-s0rgylvu.livekit.cloud`
