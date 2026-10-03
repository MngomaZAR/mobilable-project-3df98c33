# Release Status

Last evidence check: 2026-10-04. An upload receipt is not store approval or proof
that the backend used by an installed phone build passes acceptance.

## Verified History

- EAS project: `@papz/papzi`, project ID
  `f0c1ef90-ac26-4e4c-a799-77b377e2f452`.
- iOS 1.0.0 (38) finished building on 2026-09-23. Build ID:
  `453b777d-465d-488d-9b08-859e77bd3c9f`.
- Submission `094be3d5-a1f5-4530-a585-b6bc265bd759` finished uploading that
  build to App Store Connect app `6760396864`. TestFlight groups, tester email
  delivery and current public review status have not been confirmed.
- Android 1.0.0 (13) finished building on 2026-09-23. Build ID:
  `920ce9c5-d40e-48b4-92a5-f1952b7727ed`.
- Android submission `ee8e12fd-14d6-4f43-8a98-a84335ff6d89` failed. Its
  private logs identify a disabled Android Publisher API, not a successful release.

## Current Store Blockers

The existing authenticated EAS Apple API key returns HTTP 403 with
`FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`. The earlier GitHub Apple
credential returned HTTP 401; its three existing secret entries were updated
securely from the working EAS credential. No new secret names or keys were created.
The account holder must review and accept the applicable Apple agreement.
The subsequent GitHub read-only credential check (run `37159111198`) authenticated
with the synchronized key and returned that same agreement error for both iOS IDs.

The existing Google service account authenticates, but the Android Publisher API
returns HTTP 403 `SERVICE_DISABLED` for project `papz-601b5`. It also lacks
permission to inspect Service Usage. An authorized project administrator must
enable the API and confirm this account has release permissions in Play Console.

The supplied Play Console evidence identifies the verified app `paparrazziii`,
package `com.papziiii.paparazzi`. Its internal track was **inactive**, despite two
tester lists. Package registration and signing opt-in are not a distributed release.
The Android configuration now targets that package. The downloaded version 13 AAB
is for `com.saicts.papzi` and cannot update this listing.

EAS currently has signing records for `com.saicts.papzi` and `com.papzi.app`, not
`com.papziiii.paparazzi`. Neither recorded SHA-256 fingerprint matches the three
fingerprints supplied for the verified app. Recover/link the actual accepted
upload key or complete a properly authorized Play upload-key reset before building
this target. Do not generate a replacement key blindly. The Publisher API also
returns `SERVICE_DISABLED` when queried for this newly identified package.

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
- `apple-store-eas-8NSCTU6X72-20261004.json`: authenticated Apple agreement error.
- `android-submission-audit-20261004.json`: sanitized Android failure classification.
- `play-publisher-status-20261004.json`: current API/permission results.

## Latest Candidate Checks

- Frontend: 223 tests, type check, lint and private QA web compilation passed.
- API: 300 local tests, including 36 database-only skips subsequently exercised
  by isolated Oracle domain checks; later focused account-cleanup tests also passed.
- Oracle PostgreSQL 16: 61 dispatch/contract/moderation tests, 32 financial protocol
  checks and 91 account-deletion checks passed. All 12 candidate migrations applied
  in an isolated schema. Synthetic fixtures were removed; production was untouched.
- Financial provider responses and S3 were mocked in those domain protocols.
  No real refund, payout, bank verification or external acceptance evidence resulted.
- A separate real loopback LiveKit control-plane fixture passed 21 checks. Media
  tracks, public/native connectivity and actual device permissions remain unproven.
- Static runtime/architecture audits pass, but are not all-screen/device acceptance.

## Official Release Instructions

- [EAS Submit and the difference between upload and public release](https://docs.expo.dev/deploy/submit-to-app-stores/)
- [Google Play submission prerequisites](https://docs.expo.dev/submit/android/)
- [Apple agreements](https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements/)
- [Android Publisher API setup](https://developers.google.com/android-publisher/getting_started)
