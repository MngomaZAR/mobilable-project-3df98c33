# Papzi App Store Submission Prep (No Submit)

This checklist prepares Papzi for App Store Connect review without submitting a build.

## Current Expo app identity

- Name: `Papzi`
- Slug: `papzi`
- Version: `1.0.0`
- iOS Bundle Identifier: `com.papzi.app`
- App Store Connect App ID: `6760396864`
- Last verified iOS Build Number: `38`; EAS manages subsequent build numbers remotely.

The latest Apple API check succeeds. Build 38 is in internal TestFlight testing;
the public version is still `PREPARE_FOR_SUBMISSION`, not in review. This checklist
does not certify the newer candidate or replace [Release Status](RELEASE_STATUS.md).

## App Store Connect metadata to complete

### App Information

- Confirm the existing category, pricing and SKU in app `6760396864`; do not
  create a replacement listing or treat earlier suggested values as account facts.
- Complete age rating and copyright using the actual product and content policy.

### App Privacy declarations

Declare all relevant data uses:

- Location data
- Photos / media
- Messaging / chat data
- Account identifiers, contact details and profile information
- Identity-verification documents and payment/bank information actually collected
- Diagnostics and third-party SDK data collection, where applicable

Reconcile these declarations with the implementation and retention policy. Do not
declare a data category absent merely because its collection is through the API.

### Required assets

- App icon: `1024 x 1024`
- Capture real app screens for the device families supported by the submitted build.
  Current accepted 6.9-inch iPhone portrait sizes include `1290 x 2796` and
  `1320 x 2868`. A 6.5-inch set is required if a 6.9-inch set is not supplied.
  If iPad is supported, supply the required 13-inch set, for example `2048 x 2732`.
  Confirm the live requirements in Apple's [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

## Required policy links

- Privacy Policy: `https://papzii.co.za/privacy`
- Terms of Service: `https://papzii.co.za/terms`

These are intended links, not a reachability receipt. Verify public HTTPS content,
support contact details and consistency with the app before submitting.

## Review safety checks

Before review submission, verify:

- Account deletion path is available in-app.
- The public backend is accessible and every advertised action works with an
  active reviewer account. Private QA and internal TestFlight do not satisfy this.
- Content filtering, reports, blocking abusive users and timely moderation work
  in the released app. The content policy must prohibit pornographic material and
  prohibited services; an age gate alone is not sufficient.
- Payment flow distinguishes physical shoots consumed outside the app from
  digital content, subscriptions and boosts. Do not enable digital PayFast sales
  under the physical-service payment exception.
- Policy links are visible in-app and match published pages.
- Store-targeted build uses compliance env lock:
  - `EXPO_PUBLIC_STORE_TARGET=appstore`
  - `EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=true` (unless IAP is implemented)

Validate against Apple's [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
particularly backend access, user-generated content, purchases and privacy.
Signing credentials and passing these checks cannot guarantee review approval.

## Companion docs

- `docs/PAYMENT_COMPLIANCE_PATH.md`
- `docs/STORE_SUBMISSION_PACKAGE.md`

## Scope note

This document is for preparation only. It does **not** submit builds or trigger App Store review.
