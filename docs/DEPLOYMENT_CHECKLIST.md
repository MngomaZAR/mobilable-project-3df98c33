# Production Deployment Checklist

## Environment

- [ ] `.env` exists (not committed)
- [ ] `EXPO_PUBLIC_SUPABASE_URL` set to production project
- [ ] `EXPO_PUBLIC_SUPABASE_KEY` (anon/public) set
- [ ] `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` set
- [ ] Rotate any leaked keys and update `.env`

## Supabase Database

- [ ] `npm run db:migrate` completed successfully
- [ ] `payfast-handler` function deployed
- [ ] `PAYFAST_*` secrets set in Supabase
- [ ] Realtime enabled for `posts`

## PayFast

- [ ] Notify URL set to:
  `https://<project>.supabase.co/functions/v1/payfast-handler/notify`
- [ ] ITN enabled in PayFast dashboard
- [ ] Require signature enabled

## App QA (critical paths)

- [ ] Auth: sign up / sign in works
- [ ] Roles: client can book, photographer can post
- [ ] Booking: create → detail → payment
- [ ] Payment: PayFast link generates, ITN updates booking
- [ ] Feed: posts load + realtime updates
- [ ] Map: location + markers show in South Africa
- [ ] Chat: conversation list + messages load, unread badge updates

## Build

- [ ] `npm start -- --clear` for local validation
- [ ] EAS build or store build completes

## Post‑deploy

- [ ] Verify Supabase logs for errors
- [ ] Monitor Edge Function logs for PayFast ITN
