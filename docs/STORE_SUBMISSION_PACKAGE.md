# Store Submission Package (iOS + Android)

Date: 2026-03-23

This file is the final launch checklist for App Store Connect and Google Play Console submission readiness.

## 1) Required URLs

- Privacy policy: `https://papzi.co.za/privacy`
- Terms: `https://papzi.co.za/terms`
- Support: `mailto:support@papzi.co.za`
- Marketing site: `https://papzi.co.za`

## 2) Payment disclosure answers

Use the same answer pattern in both stores:

- In-app digital purchases:
  - Store builds: disabled unless native IAP is enabled.
  - External digital checkout is blocked in store-targeted builds by config + runtime policy checks.
- Real-world service booking payments:
  - Uses external PSP (PayFast), because service is fulfilled offline/in-person.

Reference: `docs/PAYMENT_COMPLIANCE_PATH.md`

## 3) iOS App Store Connect package

### App Privacy (data categories to declare)

- Contact Info: name, email, phone
- User Content: chat messages, uploaded images/media
- Identifiers: user ID, device push token
- Financial Info: transaction records (no card PAN stored in app)
- Location: precise/approximate location for matching and booking flows

### App Review notes template

1. Core service: connects users to real-world photographers/models.
2. Real-world bookings are paid via PayFast external web checkout.
3. Digital purchases are disabled in store-targeted builds unless IAP is configured.
4. Test account credentials: `<add reviewer test account>`
5. Support URL + privacy URL included in settings and metadata.

### Screenshots

Capture and upload:

1. Auth/Onboarding
2. Home discovery
3. Map + booking flow
4. Booking form + confirmation
5. Bookings list/history
6. Chat/inbox
7. Profile/settings

## 4) Google Play Console package

### Data safety declaration checklist

- Collected: email, phone, location, media, app interactions, crash diagnostics (if enabled)
- Shared: only with processors required to provide the service (payment processor, backend infra)
- Encryption in transit: Yes
- Data deletion request path: in-app + support channel

### Content rating and policy declarations

- UGC present (chat/posts): moderation + reporting flows enabled
- No prohibited content categories at launch
- Financial/payment handling through external PSP for real-world services

### Android submission config

Configured in `eas.json`:

- `submit.production.android.track = internal`
- `submit.production.android.releaseStatus = draft`

## 5) Final pre-submit checks (must pass)

1. `npm run validate:env:release`
2. `npm run typecheck`
3. `npm run test -- --passWithNoTests`
4. `npm run build:web`
5. Real-device smoke pass recorded for iOS + Android

## 6) Real-device smoke evidence to attach

For each platform attach:

- Device model + OS version
- App build/version
- Timestamp
- Pass/fail per critical flow:
  - login
  - booking create
  - booking payment redirect
  - chat send/receive
  - notifications
  - profile update
