# Release Status

Last evidence check: 2026-10-04. An upload receipt is not store approval or proof
that the backend used by an installed phone build passes acceptance.

## Current Testing Release

Restricted beta **1.0.0 (39)** is now validated and `IN_BETA_TESTING` for existing
internal `Team (Expo)` and external `papzi` groups. Jones belongs to `papzi` and
already accepted his invitation. Two live-device instruction emails were accepted
by the app SMTP server; inbox delivery and completed device tests are not confirmed.
Automatic TestFlight notifications are enabled. The stale Apple reviewer login was
replaced with verified, client-only review access, not administrator access.

Both native builds use exact candidate `deccc7a710918e96d9a01567d036a0ccfafb7151`,
which is also running publicly on Oracle after protected cutover
`20261004T104631Z`. Android version code 2 uploaded to an internal **draft**, not an
activated rollout. Public App Review remains unsubmitted. Payments, bank payouts,
video and instant dispatch are disabled in this restricted beta while their full
production gates remain unmet. See [Testing Release](TESTING_RELEASE_20261004.md)
for exact build/submission IDs, checks and sanitized tester/email receipts.

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

## Latest Candidate Checks

- GitHub run [37187833728](https://github.com/MngomaZAR/mobilable-project-3df98c33/actions/runs/37187833728):
  all 307 API tests and 25 worker tests passed with database fixtures and no skips;
  role/auth/storage/mocked-payment protocols passed, then both architectures of
  the API/worker images were pushed. Load: 300 sessions / 3,000 reads and 200
  booking/chat journeys / 1,400 writes, zero errors. CI write p95 was 5.04 seconds,
  still a concern, not evidence of production latency or marketplace parity.
  Durable in-app notifications passed; physical push and video remain unproven.
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
