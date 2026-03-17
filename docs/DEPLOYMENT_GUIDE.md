# Papzi Deployment Guide

This guide is for production deployment of the mobile app + Supabase backend.

## 1) Pre-Deploy Checklist

- Ensure branch is up to date and CI/tests are green.
- Confirm required secrets exist in Supabase and EAS:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - payment gateway secrets (PayFast)
  - LiveKit keys (if video calling enabled)
- Confirm App Store policy text and legal docs are current:
  - Terms
  - Privacy
  - Creator policy

## 2) Database Migrations (Supabase)

Run from repository root:

```powershell
npx supabase link --project-ref mizdvqhvspkjayffaqqd
npx supabase db push
```

If you need to apply all local migrations not in remote history:

```powershell
npx supabase db push --include-all
```

## 3) Deploy Edge Functions

Deploy all functions:

```powershell
npx supabase functions deploy --project-ref mizdvqhvspkjayffaqqd
```

Or deploy specific critical functions:

```powershell
npx supabase functions deploy dispatch-create --project-ref mizdvqhvspkjayffaqqd
npx supabase functions deploy dispatch-respond --project-ref mizdvqhvspkjayffaqqd
npx supabase functions deploy dispatch-state --project-ref mizdvqhvspkjayffaqqd
npx supabase functions deploy eta --project-ref mizdvqhvspkjayffaqqd
npx supabase functions deploy for-you-ranking --project-ref mizdvqhvspkjayffaqqd
npx supabase functions deploy heatmap --project-ref mizdvqhvspkjayffaqqd
npx supabase functions deploy compliance-consent --project-ref mizdvqhvspkjayffaqqd
npx supabase functions deploy payfast-handler --project-ref mizdvqhvspkjayffaqqd
npx supabase functions deploy escrow-release --project-ref mizdvqhvspkjayffaqqd
npx supabase functions deploy status-leaderboard --project-ref mizdvqhvspkjayffaqqd
```

## 4) Run Verification Suite (Must Pass)

### Static/Type Safety

```powershell
./node_modules/.bin/tsc.cmd --noEmit
node scripts/audit-src-connectivity.mjs
```

### Live Auth + Dispatch/ETA/PPV Smoke

```powershell
$env:SUPABASE_URL='https://mizdvqhvspkjayffaqqd.supabase.co'
$env:SUPABASE_ANON_KEY='<anon-key>'
$env:SUPABASE_SERVICE_ROLE_KEY='<service-role-key>'
node scripts/live-smoke-auth.mjs
```

### Full Seeded End-to-End Sweep

```powershell
$env:SUPABASE_URL='https://mizdvqhvspkjayffaqqd.supabase.co'
$env:SUPABASE_ANON_KEY='<anon-key>'
$env:SUPABASE_SERVICE_ROLE_KEY='<service-role-key>'
node scripts/e2e-full-app-sweep.mjs
```

### Jest Suites

```powershell
node node_modules/jest/bin/jest.js --runInBand
$env:EXPO_PUBLIC_SUPABASE_URL='https://mizdvqhvspkjayffaqqd.supabase.co'
$env:EXPO_PUBLIC_SUPABASE_ANON_KEY='<anon-key>'
node node_modules/jest/bin/jest.js --config jest.e2e.config.cjs --runInBand
```

## 5) Build App

### EAS Build

```powershell
npx eas-cli@latest build --platform all
```

Or iOS-only:

```powershell
npx eas-cli@latest build --platform ios
```

## 6) Post-Deploy Manual Smoke (iPhone + Real Users)

Validate these roles:

- Client
- Photographer
- Model
- Admin

Critical flows:

- Auth and role selection
- KYC/pending/approved/rejected path handling
- Booking request + instant dispatch flow
- Booking tracking map + ETA confidence updates
- Payment link generation + post-payment booking sync
- Feed PPV unlock + subscription gating
- Creator earnings dashboards and analytics
- Notification actions (accept/decline/view)
- Admin moderation queue + policy triage actions
- Contracts/model release signing

## 7) Rollback Plan

- Revert app release in EAS/App Store track if UI regression is severe.
- For backend:
  - deploy previous function versions if needed
  - apply corrective migration (forward-fix preferred over destructive rollback)
- Re-run smoke suites after rollback.

## 8) Production Readiness Gate

Only mark production-ready if all are true:

- Typecheck passes
- Connectivity audit passes (0 failed)
- Live smoke auth passes (0 failed)
- Full E2E sweep passes (0 failed, 0 warnings)
- Dashboard role checks complete
- Manual iPhone smoke complete

