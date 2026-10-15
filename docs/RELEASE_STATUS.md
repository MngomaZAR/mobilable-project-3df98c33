# Release Status

Last evidence check: 2026-10-15. An upload receipt is not store approval or proof
that the backend used by an installed phone build passes acceptance.

## Current Snapshot (2026-10-15)

The latest restricted TestFlight beta is iOS **1.0.0 (46)**, uploaded to App
Store Connect. Android version code **9** was submitted to the Play internal
testing track. These are testing artifacts, not public store review submissions
or approvals. Do not infer that the current local source is installed by testers
without checking each store's processing and tester-install status.

The latest client changes still require confirmation against the installed
store artifacts and real-device acceptance; upload or build completion alone is
not that evidence.

The live privacy, terms and account-deletion URLs currently return HTTP 200;
the 404 and empty-hosting findings in the historical section below are stale
and are retained only as history. They must not be treated as current status.
The production API is healthy but not publicly ready. Its latest verified
readiness snapshot serves revision `5e3dfc384fb3f38edc2566e9129a342af011267d`:
checkout is configured but disabled; refund execution and bank payout execution
are unavailable; video calls and instant dispatch are also unavailable. PAPZ
confirmed that a creator payout provider has not been arranged. Therefore no
live paid booking should be enabled. See
[Financial Release Runbook](FINANCIAL_RELEASE_RUNBOOK_20261015.md) for the
provider onboarding, evidence and end-to-end activation protocol.

## Latest Testing Builds

EAS currently lists iOS **1.0.0 (46)** (`fabb10e1-41bb-4947-8702-372a67aca798`)
and Android **1.0.0 (9)** (`322059ed-129c-4c1e-9083-9d316c905822`) as finished
builds from source commit `506d064c40c6ad67919d6723d917474477f9...`. The iOS
artifact was uploaded to App Store Connect and Android 9 was submitted to the
Play internal track; this does not establish tester installation, public review
submission, approval, or production release. No current physical-device
acceptance receipt was verified in this pass.

Production API revision `5e3dfc384fb3f38edc2566e9129a342af011267d` returns
healthy status, a valid database contract, road routing and 401 for unauthenticated
`/auth/me`. Readiness remains false for paid checkout/refunds/payouts, video and
instant dispatch. The released artifacts are therefore restricted test builds,
not evidence that these marketplace capabilities are ready for public use.
Public App Store and Play production review submissions are not confirmed.

## Store And Policy Status

The six published policy pages and account-deletion page returned HTTP 200 in
the 15 October 2026 live check. The old 4 October 404 findings below are history.
Public store readiness is still blocked by backend financial/media/dispatch
capabilities and device acceptance. The Play Console account's current production
access/testing requirements and both stores' submission state must be checked in
their consoles; older setup counts retained below are not current evidence.

## 15 October Verification

- `npm run check:launch`: passed, 43 suites / 398 frontend tests, typecheck,
  lint, source/runtime/architecture/schema/dashboard/payment-flow audits and web
  export.
- Backend API unit suite: 360 passed, 41 skipped because the isolated database
  integration target was not configured in this checkout.
- Public-site Playwright acceptance: 24/24 passed across 320px, 390px, 768px
  and 1440px: six policy pages, hosted auth/reload, HTTPS redirect, API CORS,
  static 404 behavior and worker MIME.
- Read-only live API probe: health 200, contract `ok=true`, routing returned 122
  road points, unauthenticated `/auth/me` returned 401. Readiness remains false
  for checkout enablement, refund, bank payout, video and instant dispatch.
- The owner confirms PayFast sandbox payments were successfully tested. This is
  accepted as completed sandbox-payment evidence; it is distinct from live
  settlement and does not, by itself, establish refunds, creator payouts, or
  coverage on the latest native builds. Preserve the existing transaction and
  callback evidence, and avoid repeating cases already verified.
- The broad dashboard Playwright suite is not accepted as passed. Its role and
  workflow specs require the isolated QA API at `127.0.0.1:18000`; that tunnel
  was not listening, the QA hostname returned HTTP 404 / failed HTTPS, and
  Papzi-specific SSH access was rejected. No synthetic fixture was sent to
  production. A local-only auth smoke also logged expected CORS errors when a
  localhost preview called the production API; the branded hosted-auth test
  passed. Do not weaken production CORS to paper over this test setup.
- `npm audit --omit=dev` reported 45 findings (26 high, 19 moderate, no critical).
  Findings span Expo/React Native/Metro and media/build dependency chains; the
  audit suggests incompatible major-version changes for some packages. Do not
  apply a blind mass upgrade. Triage reachability, update within the supported
  Expo SDK, rebuild both native apps, and rerun device/security acceptance.
- Latest EAS builds are restricted `beta-testing` artifacts: iOS 46 and Android
  9, both from `506d064c40c6ad67919d6723d917474477f99a19`. No public review
  submission or approval was verified. No production deployment or live-money
  configuration was changed in this verification pass.

The internal feature acceptance plan is in
[Financial Release Runbook](FINANCIAL_RELEASE_RUNBOOK_20261015.md). In
particular, the current beta profile points to production; any further
destructive end-to-end acceptance must use a separately verified QA API/database
and PayFast sandbox, not synthetic production transactions. Successful sandbox
payment testing has already been reported by the owner.

The sections below retain earlier checks and deployment history.

## Verified History

- EAS project: `@papz/papzi`, project ID
  `f0c1ef90-ac26-4e4c-a799-77b377e2f452`.
- iOS 1.0.0 (38) finished building on 2026-09-23. Build ID:
  `453b777d-465d-488d-9b08-859e77bd3c9f`.
- Submission `094be3d5-a1f5-4530-a585-b6bc265bd759` finished uploading that
  build to App Store Connect app `6760396864`. The current Apple API confirms
  internal TestFlight testing; tester email delivery has not been confirmed.
  Public review has not started, as detailed below.
- Android 1.0.0 (13) finished building on 2026-09-23. Build ID:
  `920ce9c5-d40e-48b4-92a5-f1952b7727ed`.
- Android submission `ee8e12fd-14d6-4f43-8a98-a84335ff6d89` failed. Its
  private logs identify a disabled Android Publisher API, not a successful release.

## Earlier Store Checks

Apple's agreement block has **cleared**. The latest read-only check returns HTTP
200 for both iOS IDs. Earlier checks returned HTTP 403
`FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`; an older GitHub key returned
HTTP 401 and its three existing secret entries were securely synchronized from EAS.
No new secret names or keys were created.

The earlier check confirmed `6760396864` is `com.papzi.app`, with valid build 38
then `IN_BETA_TESTING` internally and `READY_FOR_BETA_SUBMISSION` externally.
The public store version remains `PREPARE_FOR_SUBMISSION`, not under review.
The other app, `6760158086` / `com.saicts.papzi`, has expired build 4. The current
iOS configuration now targets the existing, successful `com.papzi.app` record.
The supplied active profile and local private certificate both match distribution
certificate serial `6B1510798D94F4A667C8EF03788E793C`, expiring March 11, 2027.

The Android Publisher API was enabled in the existing `papz-601b5` project with
explicit owner authorization. The existing service account is now Active in Play
Console with access only to `com.papziiii.paparazzi`: View app information and
Release apps to testing tracks. Google automatically includes its read-only app
quality subset. No account-wide, production, admin or financial permissions were
granted. At `2026-10-04T00:44:53Z`, package and track queries returned HTTP 200;
the temporary audit edit was discarded without committing or publishing.
Service Usage inspection still returns 403 for this deliberately restricted
account; that is not an Android Publisher API failure.

The signed-in Play Console check identifies the verified app `paparrazziii`,
package `com.papziiii.paparazzi`, app ID `4973281859732428978`. Its internal track
is **inactive**, with draft release `papzii` and no attached APK/AAB. Release preview
shows three errors: missing bundle, no valid upgrade path, and no bundle added or
removed. Package registration and signing opt-in are not a distributed release.
The Android configuration now targets that package. The downloaded version 13 AAB
is for `com.saicts.papzi` and cannot update this listing.

Play Console's actual **upload** certificate SHA-256 is
`2DC2CF575A2FF4F4E57C2D7BA3A4B12E258EF6CD83E4B0424D406302CF5CDCEA`.
It matches the existing EAS key for `com.saicts.papzi`; the three previously supplied
registration/app-signing fingerprints were not the upload certificate. Reuse this
existing key for the new package, rather than resetting or generating one. This
association is now saved in EAS, as is the existing service-account submission
credential. A repeat setup at `2026-10-04T00:48:28Z` verified both links and made
no changes. No private key was exported and no replacement key was generated.
`scripts/link-existing-android-signing.mjs` checks the project, source fingerprint
and conflicting target records; it is read-only unless explicitly given `--apply`.
Use `--apply --link-submission` to explicitly reuse both existing credentials;
the helper refuses an unexpected service account or conflicting target record.
The Publisher API access blocker is resolved. The signed-in
Google dashboard requires app setup, closed testing and production-access approval
before public release; these requirements cannot be inferred complete from an upload.

Apple and Google credentials, private keys, certificates with private material,
signed download links, auth traces and store bundles do not belong in Git.

## Runtime Acceptance Gate

The preceding guarded cutover `20261004T095413Z` promoted revision
`403cd0ef3ad032c9bdc3d58ef5b2752535ca1d69` after exact-candidate frontend CI,
323 API / 25 worker tests with no skips, and a restored-production rehearsal.
Real accounts, business records, sessions, storage and existing integration
configuration were preserved. Read-only public probes at `09:55:33Z` accepted
the new review aggregate for four creators, null averages for zero reviews,
missing-profile 404, road geometry and anonymous auth rejection. Actual runtime
account serialization also accepted the configured admin capability and rejected
forged metadata; native owner UI acceptance is still outstanding.

The updated profile/admin source is on GitHub, not installed on existing phones.
Six synthetic-transport browser checks passed; this is not live financial or
native acceptance. Latest CI write p95 is 5.16 seconds, still above the project
target. Release validation still fails the same five capability gates. No new
native binary, invitation, public submission or customer charge was made by this
pass. See [Competitive Release Evidence](competitive-release-20261004.json).

The following paragraphs retain earlier deployment/configuration history.

The initial public Oracle promotion ran backend revision `db425300` using immutable
API and worker images. Guarded cutover `20261004T013038Z` applied all 12 migrations after
backup/restore rehearsal and preserved real account, session and business-record
identities. The public health/version/schema/routing probes pass; anonymous
`/auth/me` returns 401. See [Oracle Release Runbook](ORACLE_RELEASE_RUNBOOK.md).
New frontend changes are not yet a new installed phone build.
Do not promote a QA database into production or reset existing users to test users.

At `2026-10-04T02:29:36Z`, readiness returned HTTP 200 but
`required_capabilities_available=false`. Its seven blockers are payment checkout,
production admin configuration, refund execution, bank payout execution, recovery
email, video and instant dispatch. No native release gate was overridden.
EAS production already points to the correct public API; additional environment
copies cannot supply missing merchant/email credentials or acceptance evidence.

At `2026-10-04T07:40:53Z`, guarded configuration updates had resolved production
admin allowlisting and recovery-email configuration. The restricted app mailbox
sent a real recovery email through the public API/Oracle worker, and receipt in
the owner's Gmail inbox was verified. No account password was changed. Core checks
still pass; the then-running backend reported five blockers: merchant checkout,
refunds, bank payouts, video acceptance and instant dispatch acceptance.
LiveKit cloud authentication passed from Oracle, but actual device media did not.
See [Integration Recovery](INTEGRATION_RECOVERY_20261004.md).

The current source adds `PAYFAST_CHECKOUT_ENABLED=false` by default. Complete live
credentials must not automatically authorize collecting money while refunds and
creator payouts are unverified. Readiness now reports checkout configuration and
activation separately. Payment callbacks remain available while checkout is paused.
This change requires tested matching images before runtime credential configuration;
new phone builds and public submission remain held.

Guarded cutover `20261004T082021Z` subsequently deployed exact backend revision
`c48f17e211508fbcdbd855e78075fa2ca05decfe` after GitHub CI and a fresh production
restore rehearsal. The live merchant configuration was then applied with checkout
paused to both API and worker; SMTP, LiveKit, allowlisting, users and data survived.
At `2026-10-04T08:24:49Z`, public core checks passed and readiness still returned
false with five explicit blockers: checkout activation, refunds, bank payouts,
device video acceptance and instant dispatch acceptance. Correct credential
configuration does not authorize new customer charges or establish settlement.

Read-only probes using the running container's settings authenticated with live
PayFast, SMTP TLS and LiveKit. The paused checkout code returned 503 without
creating a payment. No financial transaction or additional recovery email was sent.
EAS still targets the correct Oracle URL; server credentials were not copied into
public mobile variables. No store build, tester invitation or public submission
was started by this backend promotion.

Tester inventory at `2026-10-04T02:29:52Z` confirms Jones is in external group
`papzi`, which has **no builds**. Internal group `Team (Expo)` has valid build 38.
Build 38 remains ready for external beta submission, not externally approved.
No new candidate invitation email was sent and no public store review was started.
External testers need an accepted build assigned to their group, not an upload alone.

Required before release:

1. Immutable matching API/worker image revisions pass isolated database protocols
   and role/load tests, including durable retries and account cleanup.
2. Back up the existing production database and object storage; rehearse the
   migration and restoration before cutover. Preserve volumes and account identities.
3. Verify public HTTPS contract, readiness and road-routing endpoints; update the
   existing EAS/GitHub environment entries to that exact verified URL.
4. Independently verify merchant payment/refund/bank settlement, recovery email,
   device push and video media. Mocked providers do not establish these capabilities.
5. Run native iPhone/Android role journeys and all-screen action/accessibility tests.
   Earlier browser evidence covered 22 of 44 entry points, not every native control.
6. Check the exact binary bundle/package identity against its existing store app,
   provision and signing key. Submit a specific tested build ID, never an unchecked
   latest build. Complete store metadata, privacy declarations and reviewer access.

Feature code may exist while a capability remains disabled because its production
configuration or acceptance evidence is missing. Do not override the release gate
to obtain a green build or describe unit tests as full marketplace acceptance.

## Evidence Files

- `store-history-20261003.json`: sanitized EAS build/submission history.
- `apple-store-eas-8NSCTU6X72-20261004.json`: latest successful Apple state queries.
- `android-submission-audit-20261004.json`: sanitized Android failure classification.
- `play-publisher-status-20261004.json`: current API/permission results.
- `production-runtime-20261004.json`: public core checks and capability blockers.
- `integration-verification-20261004.json`: sanitized integration, CI/cutover and
  local-device inventory results; no credential values or private rows.
- `testflight-testers-20261004.json`: sanitized groups/Jones membership, no private emails.

## Earlier Candidate Checks

- GitHub run [37187833728](https://github.com/MngomaZAR/mobilable-project-3df98c33/actions/runs/37187833728):
  all 307 API tests and 25 worker tests passed with database fixtures and no skips;
  role/auth/storage/mocked-payment protocols passed, then both architectures of
  the API/worker images were pushed. Load: 300 sessions / 3,000 reads and 200
  booking/chat journeys / 1,400 writes, zero errors. CI write p95 was 5.04 seconds,
  still a concern, not evidence of production latency or marketplace parity.
  Durable in-app notifications passed; physical push and video remain unproven.
- The latest financial/backend acceptance run passed 83 tests across financial
  operations, payment activation, release acceptance and service acceptance.
  Those tests use simulated provider responses and do not establish live
  charges, refunds, creator transfers or bank settlement.
- The latest scoped fix passed all 246 frontend tests (23 suites); existing
  VirtualizedList `act` warnings remain. Twenty deployment safety tests passed.
  A scan found none of nine recovered secret values in the tracked HEAD content;
  this is not a complete repository-history or dependency security audit.

- Frontend: 23 suites / 246 tests, type check, lint and private QA web compilation
  pass after booking/detail/support/KYC fixes. Four expanded Oracle QA browser
  workflows pass in 44.2 seconds; booking detail was checked at 390/1440 widths.
  Twelve release-helper tests and eight Node release regressions pass. These are
  not native-device, real-payment or all-screen acceptance. See
  [October 4 Follow-Up](QA_FOLLOWUP_20261004.md).
- October 4 browser follow-up: four enabled workflows passed against private Oracle
  QA in 1.1 minutes: model rates/availability persistence; client server-priced
  booking and photographer acceptance while awaiting payment; new-model age
  declaration, real QA storage KYC upload and admin identity approval; content
  approval/rejection and outsider authorization checks. Production was untouched.
  The first follow-up run passed three and failed onboarding: an older cached
  profile overwrote the successful age declaration. Explicit session revalidation
  now fetches a fresh profile, and the complete rerun passed all four.
  Cold-start booking links and selected-provider verification outside the initial
  profile cache were also corrected. No real merchant payment, device push or
  media call is established by these browser cases.
- GitHub CI: 302 API tests with the database fixtures enabled, plus 25 worker tests.
  Local database-only skips are not counted as successful database coverage.
- Oracle PostgreSQL 16: 61 dispatch/contract/moderation tests, 32 financial protocol
  checks and 91 account-deletion checks passed. All 12 candidate migrations applied
  in an isolated schema. Synthetic fixtures were removed; production was untouched.
- Financial provider responses and S3 were mocked in those domain protocols.
  No real refund, payout, bank verification or external acceptance evidence resulted.
- A separate real loopback LiveKit control-plane fixture passed 21 checks. Media
  tracks, public/native connectivity and actual device permissions remain unproven.
- Static runtime/architecture audits pass, but are not all-screen/device acceptance.
- CI run `37161573532`: 300 role sessions / 3,000 read requests and 200 booking/chat
  journeys / 1,400 write requests completed without errors. Write-request p95 was
  5.11 seconds on the CI runner, still a performance concern. Providers and physical
  device media are outside this load test. No public launch readiness was inferred.
- The matching immutable GHCR API and worker images for
  `db425300d65f7f6336f9b6c7c99bfb2bf31927c8` were deployed to isolated Oracle QA.
  The QA database received migrations 007-012; production was not changed.
  Auth protocol: 15 checks; role protocol: 139 checks; mocked payment protocol:
  30 checks, all passed. Oracle load repeated 3,000 reads and 1,400 writes with
  zero errors. Read p95 was 2.07 seconds; write p95 was 6.26 seconds, which remains
  an unresolved responsiveness issue rather than evidence of marketplace parity.
- Oracle QA road routing returned a 3.73 km OSRM route with 122 geometry points.
  Durable in-app notification delivery passed; actual device push is not proven.
  QA still reports `ready_for_public_launch=false`. No new native build or public
  store submission was triggered from this candidate.

## Official Release Instructions

- [EAS Submit and the difference between upload and public release](https://docs.expo.dev/deploy/submit-to-app-stores/)
- [Google Play submission prerequisites](https://docs.expo.dev/submit/android/)
- [Apple agreements](https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements/)
- [Android Publisher API setup](https://developers.google.com/android-publisher/getting_started)
