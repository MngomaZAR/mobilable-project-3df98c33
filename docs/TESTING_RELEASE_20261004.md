# PAPZII Testing Release

The owner authorized distributing a restricted testing build on October 4 while
the full production payment, bank-settlement, video and instant-dispatch acceptance
work continues. TestFlight testing is not a public App Store release.

## Candidate Scope

- Existing EAS project `@papz/papzi`; no new accounts or identifiers.
- iOS `com.papzi.app`, App Store Connect `6760396864`.
- Android `com.papziiii.paparazzi`, internal testing only.
- Profile/channel `beta-testing`, production-hosted Oracle HTTPS API.
- Digital purchasing disabled. Build 39's client-side guards refuse checkout,
  financial execution, video joins and instant-dispatch writes before any network call.
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

- Exact app/backend candidate: `deccc7a710918e96d9a01567d036a0ccfafb7151`.
- Oracle API and matching worker promoted at `20261004T104631Z` after a
  production-backup restoration rehearsal. Existing identities and object storage
  were preserved; schema, 122-point road route, HTTPS health/version and anonymous
  authentication rejection passed. The five public-launch gates remain blocked.
- GitHub backend run `37195720946` passed 327 API and 25 worker tests with no
  skips, then published both image architectures. Frontend: 317 tests in 29 suites,
  typecheck and lint passed. CI read/write load had zero errors; write p95 was
  4.73 seconds. These checks are not physical-device or real-money acceptance.
- iOS build `71aed777-dd74-4446-af71-e42689ba86e3`, version `1.0.0 (39)`, finished.
  EAS submission `669d2b70-1689-401e-94f7-e61fe58ffdbe` uploaded it successfully.
  Apple validates build 39 and reports `IN_BETA_TESTING` internally and externally.
- Existing groups `Team (Expo)` and `papzi` each have one tester and build 39.
  Jones remains in `papzi` and has already accepted his TestFlight invitation.
  No public invitation link was created or distribution group expanded.
- Apple beta reviewer credentials were stale. A dedicated client-only test account
  replaced that reviewer access, with sign-in/authenticated readback/sign-out
  verified against Oracle. Existing users and administrator permissions were not
  changed. Credentials remain protected outside Git and in Apple's review fields.
- Automatic TestFlight notifications are enabled. Separate live-device instruction
  emails from the restricted app mailbox were accepted by SMTP for both registered
  testers at `2026-10-04T10:55:09Z`. Inbox receipt and tester execution are not yet
  confirmed. Private deduplication ledgers prevent blind resend after interruption.
- Android build `8c597ce1-c96f-468c-a58a-50786df7c714`, version `1.0.0` / code `2`,
  finished for the correct package. EAS submission
  `02782156-552e-49d9-8baa-88925802d5cc` uploaded successfully to an **internal draft**.
  This is not an activated Play testing release or public publication.

See the sanitized `testflight-build-39-*-20261004.json` and tester-inventory
receipts. No claim of public App Store review, production payments or Play rollout
is implied by this restricted beta.

## Operator Safety

`scripts/manage-testflight-release.mjs` uses the existing authenticated EAS key
and an explicit build number. It supports inspection, truthful notes/group setup,
verified reviewer access, beta-only review, invitation checks and tester notices.
It refuses unrelated builds/groups, incomplete/paginated scopes and unavailable
external builds. Mail/reviewer operations require separately selected protected
bridges; private credentials, recipients and retry ledgers remain outside Git.
Eleven offline safety tests cover those gates and duplicate-invitation handling.

## Guarded Activation Follow-Up

The follow-up candidate after build 39 implements account-bound, short-lived
server permissions for controlled acceptance, rather than removing the beta
restriction globally. Deploying the server alone does not update build 39's
JavaScript. A newly built testing version is required to exercise these changes.
Public checkout still requires independently accepted live refunds and creator
bank settlement; public video and instant dispatch require reviewed native-device
evidence. Missing provider credentials or evidence remain real launch blockers.

See [Service Activation Runbook](SERVICE_ACTIVATION_RUNBOOK.md) for the exact
controlled-test limits, physical-device cases, financial prerequisites and
revision-bound acceptance process. No public store approval is claimed here.
