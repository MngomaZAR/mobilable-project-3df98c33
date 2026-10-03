# PAPZII Launch Execution

Started: 2026-10-03. Updated: 2026-10-04 (Africa/Johannesburg).

## Release decision

**Public release remains blocked. Current candidate work is not publicly
deployed.** The observed public backend is still the older image: `/health`
returns 200, while `/health/readiness` and `/routing/route` return 404. Do not
bypass the readiness gate or publish a loopback/SSH-tunnel QA bundle.

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
| QA-tested | October 3 isolated Oracle baseline: 144 backend units, 138 domain checks, 15 auth checks, 30 mock-gateway payment/tracking checks; 27 browser cases and 96 screenshots. Final frontend follow-up: 14 suites / 98 tests. | These revision-specific results do not certify later changes, real payments or physical devices. |
| Publicly deployed | Older public API only. Source `291433a` GHCR images were deployed by digest to private Oracle QA. | No current candidate public cutover or release of the newer working tree is recorded here. |
| Device/store-proven | Historical September 23 build/submission receipts below. | No current-source physical iPhone/Android paid journey, full native control acceptance or public store approval. |

Business scope remains **44 screen modules** across client, photographer, model
and administrator roles. Recorded browser entry-point coverage is **22/44**, not
44-screen action coverage. Newly written workflow tests expand intended booking,
provider-service, KYC and admin-action checks only after an actual enabled QA run
records the revision, environment and results; test discovery is not a passing run.

## Execution checklist

This checklist is for production cutover and acceptance, not source completion
or private QA. Unchecked items stay open even where candidate code/tests exist.

- [x] Locate earlier attempts and identify the maintained repository.
- [x] Verify SSH access and identify running production containers.
- [ ] Identify the complete reviewed candidate revision and API/worker image digests.
- [ ] Apply new migrations in isolated QA and rehearse production backup/restore and rollback.
- [ ] Verify current auth/ownership, protected writes, quotes, availability and concurrent transitions against that exact candidate.
- [ ] Accept media privacy, delivery jobs, routing and admin moderation/incident operations.
- [ ] Configure and independently accept payment, refund, payout, recovery email, push and any enabled video/dispatch services.
- [ ] Promote reviewed GHCR API/worker images to public Oracle with explicit migrations.
- [ ] Pass public version, schema contract, readiness and domain smoke checks with production HTTPS configuration.
- [ ] Verify enabled four-role web workflows and remaining screen controls/accessibility; retain untested scope.
- [ ] Build the exact accepted source for iPhone and Android and run physical-device journeys, including permissions/reconnect/expiry.
- [ ] Resolve Apple agreements and Google Publisher API/permission blockers below; recheck synchronized credentials.
- [ ] Complete separately authorized live payment, refund and bank-settlement evidence.
- [ ] Publish web and submit native releases only after applicable gates pass; record tester availability and public approval separately.

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

- **Apple:** the authenticated EAS App Store Connect key `8NSCTU6X72` returns
  HTTP 403 `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED` for both checked
  bundle identifiers. The account holder must resolve required agreements, then
  access must be rechecked. [Read-only Apple receipt](apple-store-eas-8NSCTU6X72-20261004.json).
- **GitHub Apple credentials:** the earlier GitHub copy returned 401. The parent
  release task reports updating three existing secrets to the EAS key. This is a
  configuration change, not a post-sync successful upload; authenticated access
  must be retested, and the Apple agreement blocker is separate.
- **Google:** the local service-account credential for project `papz-601b5`
  (key identifier prefix `5842`) authenticates, but Android Publisher access is
  HTTP 403 `SERVICE_DISABLED`. The credential also lacks Service Usage permission
  to enable the API (`AUTH_PERMISSION_DENIED`). A project/account administrator
  must enable Android Publisher and verify the account's Play permissions; this
  is not merely a failed key. [Publisher status](play-publisher-status-20261004.json)
  and [submission log audit](android-submission-audit-20261004.json).

Account-holder actions have been requested asynchronously and remain pending.
The read-only audits did not retry submission, publish artifacts or change live
store state. Do not print credential material or create replacement accounts to
conceal these permission/agreement failures.

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
SMTP configuration does not establish recovery email delivery; LiveKit/push
handlers do not establish microphone/camera/push delivery on physical devices.
Media moderation operations, dependency findings, sustained load, monitoring,
trusted-proxy handling and production rollback still need accepted evidence.

The parent release task owns the new release-status report, deployment/environment
scripts and promotion. This document summarizes the checked baseline and pending
gates; it does not itself claim a deployment, store submission or payment run.
