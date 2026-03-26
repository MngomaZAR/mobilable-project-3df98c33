# Papzi App Store Submission Prep (No Submit)

This checklist prepares Papzi for App Store Connect review without submitting a build.

## Current Expo app identity

- Name: `Papzi`
- Slug: `papzi`
- Version: `1.0.0`
- iOS Bundle Identifier: `com.saicts.papzi`
- iOS Build Number: `1.0.0`

## App Store Connect metadata to complete

### App Information

- Category: `Photo & Video`
- Age Rating: required
- Copyright: required
- Pricing: `Free`
- SKU: `papzi-001`

### App Privacy declarations

Declare all relevant data uses:

- Location data
- Photos / media
- Messaging / chat data

### Required assets

- App icon: `1024 x 1024`
- Screenshots:
  - iPhone 6.7": `1290 x 2796`
  - iPhone 6.5": `1242 x 2688`
  - iPhone 5.5": `1242 x 2208`

## Required policy links

- Privacy Policy: `https://papzi.co.za/privacy`
- Terms of Service: `https://papzi.co.za/terms`

## Review safety checks

Before review submission, verify:

- Account deletion path is available in-app.
- Payment flow explains PayFast usage for real-world services and store-compliant digital purchase restrictions.
- Policy links are visible in-app and match published pages.
- Store-targeted build uses compliance env lock:
  - `EXPO_PUBLIC_STORE_TARGET=appstore`
  - `EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=true` (unless IAP is implemented)

## Companion docs

- `docs/PAYMENT_COMPLIANCE_PATH.md`
- `docs/STORE_SUBMISSION_PACKAGE.md`

## Scope note

This document is for preparation only. It does **not** submit builds or trigger App Store review.
