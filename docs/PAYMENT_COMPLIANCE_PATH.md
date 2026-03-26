# Payment Compliance Path (Store Decision)

Date: 2026-03-23

## Decision

PAPZI will use:

1. **External checkout (PayFast)** for **real-world services** (photography/model bookings).
2. **Digital purchases disabled by default** in App Store / Play Store builds until native IAP is implemented and validated.
3. **Web/Internal builds** may keep external digital checkout enabled for testing/commercial operations outside app-store billing scope.

## Store matrix

| Store target | Real-world booking payments | Digital tips/subscriptions/credits |
|---|---|---|
| `web` | External (PayFast) | External allowed |
| `internal` | External (PayFast) | External allowed |
| `appstore` | External (PayFast) | Disabled unless `DIGITAL_BILLING_PROVIDER=iap` |
| `play` | External (PayFast) | Disabled unless `DIGITAL_BILLING_PROVIDER=iap` |
| `both` | External (PayFast) | Disabled unless `DIGITAL_BILLING_PROVIDER=iap` |

## Policy basis

- Apple App Store Review Guidelines 3.1.1 (IAP for digital content/services in apps) and 3.1.5(a) (goods/services consumed outside the app may use other purchase methods):  
  <https://developer.apple.com/app-store/review/guidelines/>
- Google Play Payments policy (Google Play Billing required for in-app digital content/services; real-world goods/services excluded):  
  <https://support.google.com/googleplay/android-developer/answer/10281818?hl=en>

## Implementation status

- Enforced in runtime via `src/config/commercePolicy.ts`.
- Enforced in CI/release via `scripts/validate-env.mjs`.
- Enforced in release workflows (`ci.yml`, `eas-deploy-web.yml`, `ios-testflight-no-eas.yml`).
