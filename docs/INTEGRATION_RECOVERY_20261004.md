# Production Integration Recovery

Date: 2026-10-04. Configuration and read-only provider authentication are not
payment settlement, device acceptance, store distribution or approval.

## Recovered Existing Configuration

- Existing Supabase Edge credentials were recovered through an encrypted,
  expiring, admin-only temporary function. Anonymous requests were denied.
  That exact function was deleted and its endpoint returned HTTP 404 afterward.
- Existing LiveKit URL/key/secret authenticated with the official SDK from both
  the laptop and Oracle API container. They are configured in API and worker.
  No real participant media, physical-phone permissions or call quality was tested.
- The old payment configuration referenced a different merchant and mixed live
  and sandbox endpoints. It was not applied. The correct signed-in live merchant's
  existing key and passphrase were recovered without changing merchant settings.
  A signed read-only PayFast ping returned HTTP 200; an invalid-signature control
  returned HTTP 401. No charge, refund or payout was made.
- The PayFast account's default callback still points to the legacy Supabase
  function. New backend checkout payloads explicitly use the public Oracle
  `/payments/payfast/itn` callback. Account-level callback settings were not changed.

## Configuration Applied To Oracle

- Verified active owner added to the server-owned admin allowlist in both writers.
  This is API authorization configuration, not proof that native admin navigation
  or every moderation action has passed acceptance.
- With explicit owner approval, created only `noreply@papzii.co.za`, quota 100 MB.
  Existing mailboxes remain unchanged. The hosting administrator password is not
  an app credential.
- Configured TLS SMTP on port 465 plus a persistent recovery encryption key in
  API and worker. SMTP certificate validation and authentication passed locally
  and from Oracle.
- Public recovery request returned HTTP 200. Its durable worker job completed
  on attempt one, marked the message sent and removed the encrypted reset token
  from the outbox payload. The email arrived in the owner's Gmail inbox, not spam.
  No reset link was activated and no password changed.
- Configuration receipts are root-only on Oracle:
  `/var/backups/papzii/configuration-20261004T073151Z` and
  `/var/backups/papzii/configuration-20261004T074010Z`.
  Both updates preserved immutable images, production database, volumes and users.

## Financial Activation Guard

New checkout is default-off even when merchant credentials exist. A paused request
fails before opening the database or creating a payment. ITN authentication and
confirmation remain independent, so disabling new checkout does not drop incoming
notifications for existing payments.

The configuration helper accepts only a complete merchant configuration with
checkout explicitly paused, rejects in-place merchant rotation, and refuses to
apply merchant credentials to an older image that lacks this guard. It cannot
activate checkout, enable refunds/payouts or forge financial acceptance records.

The source change has five new payment tests. Local API tests: 307 run, 271 passed,
36 database-dependent skips. The subsequent database-backed CI run passed all 307
API tests and 25 worker tests without skips. Deployment guards: 20 passed, including
preservation of an existing recovery encryption key.

## Verified Follow-Up Deployment

- GitHub run [37187833728](https://github.com/MngomaZAR/mobilable-project-3df98c33/actions/runs/37187833728)
  passed tests and built matching immutable images for
  `c48f17e211508fbcdbd855e78075fa2ca05decfe`.
- Fresh production backup restoration, schema checks and identity comparison passed
  at `20261004T081807Z`; all 12 migration ledger entries were preserved.
- Cutover `20261004T082021Z` preserved accounts, sessions, business identities,
  database and volumes, and created a fresh object-storage archive.
- Merchant configuration `20261004T082215Z` applied the correct live credentials
  to both API and worker with `PAYFAST_CHECKOUT_ENABLED=false`. It preserved the
  existing SMTP/recovery key, LiveKit and admin settings.
- Read-only authentication using the running API's settings passed for PayFast
  (valid 200, invalid signature 401), SMTP with certificate verification and
  LiveKit. A direct running-code checkout safety probe returned 503 while paused.
  That probe is not an authenticated, native-user payment journey.
- Public audit at `2026-10-04T08:24:49Z`: correct revision, health/schema HTTP 200,
  road route with 122 points / 3.73 km / 450.7 seconds, anonymous auth HTTP 401.
  Readiness remains false for checkout activation, refunds, bank payouts, video
  and instant dispatch. No real financial transaction was performed.
- CI load: 300 sessions / 3,000 reads, zero errors, read p95 1.345 seconds;
  200 booking/chat journeys / 1,400 writes, zero errors, write p95 5.039 seconds.
  These are CI measurements, not production guarantees. Actual device push/media
  are outside that load test.
- Nine recovered secret values were checked against tracked HEAD content; no
  matches were found. This does not establish a clean entire Git history.

## Existing Device Resources

The laptop has iCloud, iTunes and Apple Devices installed, Android platform tools,
an existing `Pixel_4` AVD and usable Windows Hypervisor acceleration. ADB currently
reports no running emulator or USB Android device. Enumerated Apple Bluetooth
devices are not an iPhone USB test/control connection; iCloud is not an iOS simulator.
No personal iCloud photos, files or messages were needed or inspected.

No local candidate APK was found in Downloads or Android build outputs. The ignored
generated `android/` project still uses `com.saicts.papzi`; it must not be treated
as a current `com.papziiii.paparazzi` candidate. `.easignore` already excludes this
stale native project, so EAS generates the current native configuration. Local
emulator testing needs a deliberately regenerated or correctly identified debug
candidate, without destroying custom native changes. Installed-device acceptance
has not passed merely because tools are installed.

## Remaining Release Evidence

- Real payment, refund and creator bank settlement with reconciled records.
- Actual iPhone/Android video and push delivery, including denied permissions.
- Instant dispatch acceptance, all four role journeys and all 44 screens/actions.
- Native accessibility, privacy/moderation and store listing/reviewer checks.
- Load latency improvement, protected off-host backups, alerting and restore tests.

No new native build, external TestFlight invitation, Google Play release or public
review was started by this configuration work. Runtime secrets and private user
records are not committed to Git or copied into public EAS variables.
