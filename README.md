# Papzi

Mobile-first creator marketplace app built with Expo + React Native + Supabase.

## Core Product Scope

- Discovery: photographers and models
- Live map experience (dark/light)
- Booking flow with packages, add-ons, and dispatch settings
- Chat and conversation threads
- Feed and profile interactions
- Payments and creator monetization flows
- Admin and compliance screens

## Environment

Create a `.env` from `.env.example` and set:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

No API secrets are hardcoded in app config or EAS profiles.

## Run

```bash
npm install
npm run start
```

Platform shortcuts:

- `npm run web`
- `npm run android`
- `npm run ios`

## Launch Checks

Run the full launch gate:

```bash
npm run check:launch
```

This runs:

1. Type check
2. Lint
3. Unit tests
4. Source connectivity audit
5. Web export build

## Useful Scripts

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run audit:src`
- `npm run build:web`
- `npm run preview:web` (serve exported `dist` at local preview URL)

## Notes

- The app keeps all planned UX surfaces (map/home/bookings/chat/profile) and does not remove product features.
- Some data-heavy smoke scripts require Supabase auth/service-role environment variables.
