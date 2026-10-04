# PAPZII Testing Release

The owner authorized distributing a restricted testing build on October 4 while
the full production payment, bank-settlement, video and instant-dispatch acceptance
work continues. TestFlight testing is not a public App Store release.

## Candidate Scope

- Existing EAS project `@papz/papzi`; no new accounts or identifiers.
- iOS `com.papzi.app`, App Store Connect `6760396864`.
- Android `com.papziiii.paparazzi`, internal testing only.
- Profile/channel `beta-testing`, production-hosted Oracle HTTPS API.
- Digital purchasing disabled. Builds 40 and 41 use authenticated, token-bound,
  short-lived service permissions; general checkout, financial execution, video
  joins and instant dispatch stay paused. Explicit controlled-test accounts are
  not public service activation. Build 39 retains its older blanket client guards.
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

## Current Build 41 / Android Code 4 Delivery

- Exact source: `200d60599c92c800ab29bba6eb8b4a4a1b7cfdf6`, matching public Oracle
  protected cutover `20261004T145154Z` and all 13 migrations.
- iOS EAS build `4bac4c43-00a3-4774-a901-5d132596b567`, `1.0.0 (41)`;
  submission `cbfae5a4-beca-4f6a-b172-93dd576df956` finished at `14:51:34Z`.
  Apple validates it and reports internal/external `IN_BETA_TESTING`.
- Existing `Team (Expo)` and `papzi` groups each retain one tester and build 41.
  Jones already joined; no new group, public link or duplicate join invitation.
  Auto-notification remains enabled.
- Two build-41 instruction emails were SMTP-accepted at `15:07:36Z`; inbox receipt
  and completed native tests remain unverified. Build-specific private ledgers
  prevent blind resend.
- Android EAS build `86de4fe4-9d56-4b09-9cf8-ff15e017eb4e`, `1.0.0` / code `4`;
  submission `9058d4f2-9214-472f-a75b-ab6690939d6b` finished at `15:06:16Z`.
  The signed-in Console activated only the existing internal track. Publisher
  API readback at `15:18:19Z` confirms code 4 `completed`; production is empty.
- Existing internal tester lists remain selected. Join through
  [the existing Play internal test](https://play.google.com/apps/internaltest/4701137796431968292)
  with an authorized Google account. Store propagation may take time.
- Play reports one nonblocking code-4 deobfuscation-file warning. No supported
  devices were dropped relative to code 3; 12,248 phone models were shown. This
  is store compatibility metadata, not testing every device.
- Matching [web preview](https://papzi--swvsndvpq2.expo.app) passed client sign-in,
  Home/Map/Bookings/Feed/Settings, actual map tile/canvas rendering and sign-out
  at 390x844 and 1440x900, without API errors, crashes or horizontal overflow.
- [Native Map Follow-Up](NATIVE_MAP_ACCEPTANCE_20261004.md) records fixes and
  physical-device limits; [Candidate Evidence](RELEASE_CANDIDATE_200D605_20261004.md)
  records CI, backup, runtime and scope.

Full public marketplace activation remains held. Play additionally has 0 of 11
app setup tasks complete and 0 closed-testers against its 12-testers/14-days gate.
Privacy/terms URLs return 404 and legacy native legal content requires owner
review and correction. See [Public Store Gates](PUBLIC_STORE_GATES_20261004.md).

## Build 40 / Android Code 3 History

- Runtime/app candidate `871ec85ac00af86108b3b3525515bbb8d8814cad`; Oracle protected
  cutover `20261004T134217Z`, with all 13 migrations and real identities preserved.
- iOS EAS build `c022e24b-4a3d-42f9-bbb5-08cc5d3fcf2f`, `1.0.0 (40)`;
  submission `ea1f7933-68e3-4c63-9aaf-c858a69e4234` finished uploading.
  Apple validates it and reports internal and external `IN_BETA_TESTING`.
- Existing `Team (Expo)` and `papzi` groups retain their one tester each. Build 40
  is assigned to both. Jones has already joined; no duplicate join invitation,
  new public link or group expansion was made. Auto-notification is enabled.
- Two build-40 testing emails were SMTP-accepted at `2026-10-04T13:59:23Z`.
  Inbox receipt and completed device tests remain unverified. Private build-specific
  ledgers prevent blind resend after a timeout.
- Android EAS build `bbc79d22-981a-47eb-b157-d556f627ad79`, version code `3`;
  submission `99e7358d-aed2-4ae7-bd2e-9f5fc060002f` finished uploading an internal
  draft. The owner-authorized testing release was then activated in Play Console.
  Publisher API readback at `2026-10-04T14:09:54Z` confirms code 3, `completed` on
  `internal`; the Console reports Active. Public `production` remains empty.
- Play reports one nonblocking warning: no deobfuscation file for code 3.
  Successful internal activation is not production-access approval or device proof.
- Matching hosted web preview:
  [papzi--n30gcfhwzg.expo.app](https://papzi--n30gcfhwzg.expo.app).
  Live review-account sign-in, normal age declaration, Home/Map/Bookings/Feed/
  Settings and sign-out passed at 390x844 and 1440x900; screenshots remain private.
- Detailed candidate, CI, load, backup and readiness evidence is in
  [Latest Candidate](RELEASE_CANDIDATE_871EC85_20261004.md).

## Build 39 History

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
Thirteen offline safety tests cover those gates, explicit build-39/40/41 authorization,
expired/processing build rejection and duplicate-invitation handling. CI runs
these checks without provider credentials or sending mail.

## Guarded Activation Follow-Up

The deployed candidate implements account-bound, short-lived
server permissions for controlled acceptance, rather than removing the beta
restriction globally. Deploying the server alone does not update build 39's
JavaScript. Install build 41 to exercise these changes when explicitly authorized.
Public checkout still requires independently accepted live refunds and creator
bank settlement; public video and instant dispatch require reviewed native-device
evidence. Missing provider credentials or evidence remain real launch blockers.

See [Service Activation Runbook](SERVICE_ACTIVATION_RUNBOOK.md) for the exact
controlled-test limits, physical-device cases, financial prerequisites and
revision-bound acceptance process. No public store approval is claimed here.
