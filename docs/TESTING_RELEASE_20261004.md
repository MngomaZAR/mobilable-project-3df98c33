# PAPZII Testing Release

The owner authorized distributing a restricted testing build on October 4 while
the full production payment, bank-settlement, video and instant-dispatch acceptance
work continues. TestFlight testing is not a public App Store release.

## Candidate Scope

- Existing EAS project `@papz/papzi`; no new accounts or identifiers.
- iOS `com.papzi.app`, App Store Connect `6760396864`.
- Android `com.papziiii.paparazzi`, internal testing only.
- Profile/channel `beta-testing`, production-hosted Oracle HTTPS API.
- Digital purchasing disabled. Client-side guards also refuse checkout, financial
  execution, video joins and instant-dispatch writes before any network call.
- Profile/discovery/feed, registration/password login/recovery, scheduled booking
  requests, acceptance, chat, routing and authorized moderation remain testable.
- No test redirect or mock can mark payment, completion or bank settlement true.
- Public `production` profiles retain the full release gate. The testing profile
  separately validates its restricted configuration plus DNS, health, schema and
  real road geometry; it cannot enable purchasing or change to public scope.

## Tester Instructions

Use TestFlight's newest build after it is explicitly assigned to your group.
Test sign-up/password sign-in, profile editing, discovery, feed, scheduled request
and creator acceptance, messaging, road directions, retry after disconnection,
logout/sign-in and reporting. Creators should also test availability and published
services. Admin testing requires the existing server allowlist; editing profile
roles does not grant administrator access.

Record the version/build, role, device/OS, screen, steps and screenshot for failures.
Do not enter bank details or attempt real payments in this restricted beta.
Payment confirmation, refunds, payouts, video and instant dispatch are not accepted
production features merely because a testing build installs.

## Financial Inventory

A read-only Oracle check found no encrypted bank rows, financial operation rows or
provider-acceptance rows. The running API and worker are aligned and healthy, but
Stitch payout credentials and bank encryption configuration are absent. No matching
payout credentials were found in environment/credential files of the four previous
Papzi attempt folders searched. This bounded search does not prove none exist
elsewhere on the device or in external accounts.

The recovery bridge already retains the correct live PayFast and LiveKit settings
privately. PayFast checkout credentials are not creator-bank payout authorization.
Do not create acceptance records without real provider readback and independent
evidence. The public readiness endpoint now consults the guarded financial
acceptance checks, rejecting sandbox evidence and failed database reads.

## Release Evidence

Build IDs, Apple processing/group availability, Play upload/release state and
invitation requests must be recorded separately after each provider returns them.
This document is a plan and scope record, not proof that a build, submission or
tester email has completed.
