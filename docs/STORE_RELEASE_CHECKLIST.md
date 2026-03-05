# Store Release Checklist (Papzi)

## App Metadata
- App name, slug, bundle IDs updated in `app.json`
- Version and build numbers set for iOS + Android
- App icons and splash assets replaced
- App Store / Play Store descriptions ready

## Privacy & Compliance
- Privacy policy URL added to store listings
- Terms of service URL added to store listings
- Data deletion request flow verified
- Location permission text reviewed

## Production Config
- `.env` contains correct Supabase URL + anon key (no service role keys)
- PayFast production or sandbox endpoint configured
- Supabase Edge Functions deployed
- RLS policies verified for bookings, messages, and storage

## Functional QA
- Auth: sign up, sign in, sign out
- Booking: create booking, status updates
- Payments: PayFast checkout + ITN updates
- Feed: create post, see in feed
- Chat: create conversation, send messages, unread counts
- Maps: user location + photographer markers

## Build & Release
- Expo build runs for iOS and Android
- No blocking warnings or crash loops
- Analytics / crash reporting enabled
