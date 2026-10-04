# Release Status

Last evidence check: 2026-10-04. An upload receipt is not store approval or proof
that the backend used by an installed phone build passes acceptance.

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

## Current Store Blockers

Apple's agreement block has **cleared**. The latest read-only check returns HTTP
200 for both iOS IDs. Earlier checks returned HTTP 403
`FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`; an older GitHub key returned
HTTP 401 and its three existing secret entries were securely synchronized from EAS.
No new secret names or keys were created.

App Store Connect confirms `6760396864` is `com.papzi.app`, with valid build 38
currently `IN_BETA_TESTING` internally and `READY_FOR_BETA_SUBMISSION` externally.
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

The public Oracle API currently runs an older deployment. The tested candidate is
on private Oracle QA, not automatically the backend used by existing phone builds.
Do not promote a QA database into production or reset existing users to test users.

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

## Latest Candidate Checks

- Frontend: 20 suites / 226 tests, type check, lint and private QA web compilation
  passed again after the age-gate cache fix. These are not native-device acceptance.
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
