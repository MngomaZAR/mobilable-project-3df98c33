# PAPZII Launch Execution

Started: 2026-10-03. Updated: 2026-10-04 (Africa/Johannesburg).

## Release decision

**Public store release remains blocked. The tested backend is publicly deployed.**
Oracle now runs immutable API/worker revision `403cd0e` after a protected restore
rehearsal and cutover. Public health, schema and road routing pass; readiness
returns HTTP 200 with `required_capabilities_available=false`, not the older 404.
The five blockers are checkout activation, refunds, bank payouts, video acceptance
and instant dispatch acceptance. Do not bypass the gate or publish a loopback/
SSH-tunnel bundle. See [current evidence](competitive-release-20261004.json) and
[earlier integration evidence](integration-verification-20261004.json).

A successful build, credential synchronization or healthy container is not proof
of a working marketplace. Production deployment, signed native builds, device
acceptance and store publication each need separate receipts.

## Source of truth

The maintained application is this repository, connected to
`MngomaZAR/mobilable-project-3df98c33`. The older Flutter projects in
`Downloads/papz_app_mobile*` are starter projects, not the active release.
`papzi_ver_10/mobilable-project-3df98c33` contains an earlier Supabase-era build.
Use it for historical requirements, not current deployment configuration.

The canonical path is Expo mobile/web -> public HTTPS FastAPI -> authenticated
domain commands -> Oracle PostgreSQL and private S3-compatible storage. Existing
Oracle media uses MinIO; CI separately tests SeaweedFS through the same S3 boundary.
Storage migration is not complete merely because that fixture passed. OSRM is
private behind the API. NATS/Typesense container presence is not realtime/search
acceptance; current messaging is persisted HTTP polling. Supabase is not the
production runtime. See [Single-Flow Architecture](SINGLE_FLOW_ARCHITECTURE.md).

## Evidence Levels

| Level | Recorded State | Not Established |
|---|---|---|
| Implemented | Source has auth/session protection, owner-scoped data, domain booking/pricing/availability, storage and moderation commands. New financial, dispatch, contracts, video, deletion and delivery implementations are candidate work. | Source presence is not deployment or complete integration acceptance. |
| QA-tested | Exact-backend CI: 323 API tests, 25 worker tests, no skips; role/auth/storage/mocked-payment protocols passed. Frontend: 27 suites / 300 tests and six synthetic-transport profile/admin browser checks. CI load: 300 read sessions and 200 booking/chat journeys, zero errors; write p95 5.16 seconds. Older Oracle/browser evidence remains revision-specific. | No live financial settlement, physical device media/push or complete native control acceptance. |
| Publicly deployed | Exact `403cd0e` API/worker images promoted at `20261004T095413Z`; all 12 migrations, real identities and volumes preserved. Public review aggregate and runtime admin capability pass narrow probes. Correct merchant, SMTP and LiveKit settings survive; recovery email reached the owner's inbox earlier. Checkout remains paused. | This backend cutover is not a new installed phone binary or public store approval. |
| Device/store-proven | Historical September 23 build/submission receipts below. | No current-source physical iPhone/Android paid journey, full native control acceptance or public store approval. |

Business scope remains **44 screen modules** across client, photographer, model
and administrator roles. Recorded browser entry-point coverage is **22/44**, not
44-screen action coverage. Newly written workflow tests expand intended booking,
provider-service, KYC and admin-action checks only after an actual enabled QA run
records the revision, environment and results; test discovery is not a passing run.

October 4 follow-up against the isolated `db425300` Oracle backend and updated
frontend working tree passed four enabled workflows: model rates/availability,
client booking/photographer acceptance, new-model age/KYC/admin identity review,
and content moderation/outsider authorization. The initial onboarding failure
was traced to stale profile-cache reuse after age confirmation and corrected.
The full rerun passed in 1.1 minutes. Frontend typecheck, lint and 20 suites / 226
tests also passed. These narrow cases do not certify all controls or real payments,
device push, video media, or the older public deployment.

## Execution checklist

This checklist is for production cutover and acceptance, not source completion
or private QA. Unchecked items stay open even where candidate code/tests exist.

- [x] Locate earlier attempts and identify the maintained repository.
- [x] Verify SSH access and identify running production containers.
- [x] Identify the reviewed backend candidate revision and API/worker image digests (`403cd0e`; see Competitive Release Evidence). Updated frontend source is not an installed native candidate.
- [x] Apply new migrations in isolated QA and rehearse production backup/restore and guarded pre-reopen rollback.
- [x] Verify auth/ownership, protected writes, quotes, availability and concurrent transitions in exact-candidate isolated CI. Public native-role acceptance remains separate.
- [ ] Accept media privacy, delivery jobs, routing and admin moderation/incident operations.
- [x] Configure the restricted recovery mailbox and verify real owner-inbox delivery, durable worker completion and token scrubbing without changing the owner's password.
- [x] Recover the correct merchant and existing LiveKit credentials, verify authentication from Oracle and configure both writers without enabling checkout.
- [ ] Independently accept live payment/refund/payout, device push/media and enabled dispatch services before activation.
- [x] Promote reviewed GHCR API/worker images to public Oracle with explicit migrations (latest cutover `20261004T095413Z`).
- [x] Pass public health/version, schema contract, road geometry and anonymous access rejection.
- [ ] Pass public version, schema contract, readiness and domain smoke checks with production HTTPS configuration.
- [ ] Complete all enabled four-role screen controls/accessibility; targeted booking/chat/support/KYC/moderation workflows have QA evidence, not full coverage.
- [ ] Build the exact accepted source for iPhone and Android and run physical-device journeys, including permissions/reconnect/expiry.
- [x] Recheck Apple API access; enable Android Publisher with authorization, verify app-only testing access, and link the verified existing EAS upload key and submission credential. No new candidate was uploaded.
- [ ] Complete separately authorized live payment, refund and bank-settlement evidence.
- [ ] Publish web and submit native releases only after applicable gates pass; record tester availability and public approval separately.

## Native Testing And Tester Distribution

1. Use the existing `Pixel_4` emulator and installed Android SDK; hardware
   acceleration is available. ADB currently has no running device. Do not download
   another emulator or confuse the stale ignored `com.saicts.papzi` native folder
   with the accepted `com.papziiii.paparazzi` candidate. Preserve custom native
   changes before deliberate regeneration and identify the exact APK revision.
2. Run candidate client, photographer, model and admin journeys, then the 44-screen
   action matrix. Include admin allowlist versus profile-role navigation, revoked
   permissions, session expiry, offline/reconnect, private attachments, road
   directions, moderation, recovery and durable retries. Save failures as failures.
3. Use a real iPhone/Android for camera/microphone/GPS/push and performance
   acceptance. Installed iCloud/Apple Devices software and Bluetooth pairing are
   not native app-control or media-delivery evidence. Store-distribution builds
   reuse existing credentials; iCloud personal content is not required.
4. Build the accepted source and record exact source, runtime, bundle/package,
   signing identity, version and EAS build ID. Submit by that ID, not `--latest`.
   Do not silently change public release scope or bypass capability failures.
5. For TestFlight, check Apple processing/export compliance and availability,
   then assign the accepted build to the existing requested groups. The recorded
   external `papzi` group includes Jones but has no candidate build; `Team (Expo)`
   has historical build 38. External beta review is not public App Review.
6. For Google Play, use the existing app-only testing service-account permissions
   and matching upload key. Complete the internal-track candidate release and
   verify registered tester-list access and the opt-in link. A draft AAB upload is
   not an installable test release; do not grant production or financial access.
7. Verify actual tester installation/invitation evidence separately from upload
   receipts. Public publication remains a later gate with financial, privacy,
   moderation, reviewer and operational acceptance.

## Historical Candidate QA

The [October 3 candidate report](QA_CANDIDATE_FOLLOWUP_20261003.md) records:

- Authenticated/owner-scoped data, server admin allowlist and protected financial writes.
- Migrations 001-006 on separate Oracle QA; server quotes, retry/concurrency protection and paid tracking gates.
- Payment signature/amount/replay checks with mocked external validation; no money moved.
- Durable in-app notifications, real MinIO media/privacy checks and Oracle OSRM road geometry.
- Synthetic KYC/registration/age, provider equipment/availability, session settings, discovery, chat and map regressions.
- CI/GHCR API and worker images for source `291433aaa38af76f6bc8dd1bc7ce5c830c4a61e4`, AMD64/ARM64, deployed by exact digest to private QA only.
- A 300-account role/load fixture and 200 concurrent booking/chat journeys. The recorded Oracle write-request p95 around six seconds remains a performance concern, not excellent responsiveness.
- A separate production backup restore rehearsal and real SeaweedFS signed-access/restart fixture. Neither proves an accepted production storage migration or actual rollback.

The later conversation-header web follow-up retained 27 passing cases / 96
screenshots and 22/44 entry points. The temporary browser server and SSH tunnel
were stopped. Do not imply newer admin/workflow/financial code has run live merely
by reusing these older receipts. The [earlier QA report](QA_RELEASE_REPORT_20261003.md)
retains failed attempts and their subsequent fixes.

Initial public-baseline findings included unprotected generic data/schema writes,
privileged signup metadata, client-controlled checkout, an inert worker, internal
media URLs and invented route fallbacks. Candidate code addresses those issues;
their historical discovery is not a fresh audit of every old public endpoint.
Promotion and public regression checks remain necessary. The legacy automatic
Dokploy workflow was disabled after a green no-op; image publication or skipped
redeploy steps must never be recorded as production deployment.

## Native And Store Receipts

Historical receipts are in [store history](store-history-20261003.json):

| Platform | Receipt | Limit |
|---|---|---|
| iOS | Build `453b777d-465d-488d-9b08-859e77bd3c9f`, build number **38**, `FINISHED` on 2026-09-23; source `0f302a3dcfff8fd4ef3cf514347125b6d33bbdeb`. Submission `094be3d5-a1f5-4530-a585-b6bc265bd759` finished for App Store Connect app **6760396864**. | Historical build/upload receipt, not current-source tester availability, device acceptance or public approval. |
| Android | Build `920ce9c5-d40e-48b4-92a5-f1952b7727ed`, version code **13**, `FINISHED` on 2026-09-23; source `0fe95564e949d05a0ccd6227813326f9e2e2868c`. Internal/DRAFT submission `ee8e12fd-14d6-4f43-8a98-a84335ff6d89` is `ERRORED`. | Log audit identifies `publisher_api_disabled`; a completed build is not a Play release. |

October 4 local-date account checks (receipts use October 3 late-evening UTC):

- **Apple:** the latest authenticated check now returns HTTP 200; the earlier
  agreement block has cleared. App `6760396864` / `com.papzi.app` has valid build
  38 in internal beta testing, externally ready for beta submission. Its public
  version is still `PREPARE_FOR_SUBMISSION`. App `6760158086` / `com.saicts.papzi`
  has expired build 4. Configuration now targets the successful `com.papzi.app`
  identity and the matching existing private signing certificate/profile.
  [Read-only Apple receipt](apple-store-eas-8NSCTU6X72-20261004.json).
- **GitHub Apple credentials:** the earlier GitHub copy returned 401. The parent
  release task reports updating three existing secrets to the EAS key. This is a
  configuration change, not a post-sync successful upload. The EAS key now reads
  Apple records successfully; GitHub uses that same synchronized credential.
- **Google:** Android Publisher is now enabled in `papz-601b5`. With explicit
  authorization, the existing service account received View app information and
  testing-release access only to `com.papziiii.paparazzi`, including Google's
  mandatory read-only app-quality subset. Package and track queries returned 200;
  the temporary audit edit was discarded. No production, financial, admin or
  account-wide access was granted. Service Usage inspection remains restricted,
  which does not prevent these verified Publisher calls.
  [Publisher status](play-publisher-status-20261004.json) supersedes the old
  [submission log failure](android-submission-audit-20261004.json).
  The accepted upload certificate matches the existing EAS key, now linked to
  the confirmed package along with its existing submission credential. No reset
  or private-key export was needed. The internal release is still an inactive,
  empty draft with no bundle or version code; no new candidate was uploaded.

These specific Google account-access blockers are resolved; Apple API access has
also been restored. The authorized API/permission/EAS configuration changes did
not retry submission or publish a release. Production runtime, integrations,
device acceptance and store setup remain separate gates. Do not print credential
material or create replacement accounts to conceal remaining readiness gaps.

## Launch product

The first revenue journey is a scheduled in-person shoot: discover a vetted
creator, select a published service/package and time, obtain a server quote,
reserve availability, accept while awaiting payment, pay, communicate, fulfil,
deliver, reconcile earnings and review. Model bookings must pass the same
ownership/pricing/payment contract. Cancellation copy must not promise a refund
that has not been executed; earnings/payout records must not imply bank settlement.
Digital purchases remain disabled in store builds until compliant native billing
is implemented and tested. Preserve the 44-screen business scope while disabling
or truthfully labeling unsupported capabilities.

## Evidence required

Record commit, deployment version, device/browser, role and timestamp for each
test. Test reconnects, expired tokens, concurrent requests, cancellations and
payment webhook replay as well as the successful journey. Do not mark device
tests, live settlement, refunds or store review complete from source checks.

SecureStore unit tests do not establish device encryption/biometric enforcement;
SMTP configuration alone does not establish recovery email delivery; the latest
owner-inbox receipt is one verified delivery journey, not all native recovery UX.
LiveKit/push handlers do not establish microphone/camera/push delivery on physical devices.
Media moderation operations, dependency findings, sustained load, monitoring,
trusted-proxy handling and production rollback still need accepted evidence.

The current release task maintains the release-status report, deployment scripts
and protected promotion receipts. This document summarizes checked milestones and
pending gates; store approval and real settlement have not been established.
