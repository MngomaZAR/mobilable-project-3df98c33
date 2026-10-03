# PAPZII Launch Execution

Started: 2026-10-03

## Release decision

Public release is blocked until the production checks and complete paid booking
journeys below pass. A successful build or a healthy container is not proof of a
working marketplace.

## Source of truth

The maintained application is this repository, connected to
`MngomaZAR/mobilable-project-3df98c33`. The older Flutter projects in
`Downloads/papz_app_mobile*` are starter projects, not the active release.
`papzi_ver_10/mobilable-project-3df98c33` contains an earlier Supabase-era build.
Use it for historical requirements, not current deployment configuration.

The active Oracle deployment has FastAPI, PostgreSQL, MinIO, NATS and Typesense.
The phone must use the public HTTPS API; internal Docker hostnames must never
appear in response URLs. Supabase is not the production runtime.

## Execution checklist

This checklist is for production cutover and acceptance, not candidate QA. QA
completion is recorded separately below; unchecked production items remain open.

- [x] Locate earlier attempts and identify the maintained repository.
- [x] Verify SSH access and identify running production containers.
- [ ] Enforce authentication, ownership and protected server-managed fields.
- [ ] Replace request-time schema creation with explicit migrations.
- [ ] Make booking prices and status transitions server-authoritative.
- [ ] Prevent duplicate and overlapping bookings.
- [ ] Verify payment notifications, amounts, retries and earnings records.
- [ ] Process durable background jobs and expose actionable failures to admins.
- [ ] Return publicly reachable media URLs with private access enforcement.
- [ ] Use road routing and honest failure states.
- [ ] Align release configuration and CI with the deployed backend.
- [ ] Verify visible controls and four-role journeys on the web.
- [ ] Verify the exact native build on iPhone and Android.
- [ ] Complete approved live payment, refund and payout evidence.
- [ ] Publish web and submit native releases only after the gates pass.

## Candidate QA Completed

- [x] Authenticated data access, ownership, admin allowlist and financial-write protection.
- [x] Explicit migrations applied to the separate Oracle QA database; no runtime DDL.
- [x] Server booking quotes, protected transitions, idempotency and concurrent slot protection.
- [x] Payment signature/amount/replay checks with mocked external validation, not live settlement.
- [x] Worker drains durable notifications into persistent records, not verified device push.
- [x] Real MinIO upload, recipient media access and outsider/KYC denial tests.
- [x] Controlled South Africa OSRM route service provisioned on Jones Madunga's Oracle instance.
- [x] Fresh registration/age declaration and four-role browser navigation at three sizes.
- [x] KYC document submission, administrator decisions and verification revocation tested with synthetic documents.
- [x] Public release validation now rejects unavailable capabilities, not just unhealthy containers.
- [x] Equipment save/retry/array round-trip and atomic tier synchronization tested; explicit model offerings blocked in API/mobile.
- [x] Expanded phone settings entry-point checks find and repair the equipment permission error; 20 screen modules now have browser evidence, not complete action coverage.
- [x] Production/store EAS pre-install hook rejects the incomplete public backend, including direct dashboard builds; six hook-selection tests pass. Custom build definitions need an explicit hook call.
- [x] Latest repeat passes 144 backend units, 138 HTTP/domain checks, 15 auth checks and 30 mock-gateway payment/tracking checks; no real money moved.
- [x] Final browser repeat passes 27 cases and captures 96 screenshots; map and chat bring entry-point evidence to 22/44 modules, not every action.
- [x] Final source unit run passes 96 tests; missing-location pins, road-snap rejection, published pricing and long chat text have regressions.

See `QA_CANDIDATE_FOLLOWUP_20261003.md` for current evidence and
`QA_RELEASE_REPORT_20261003.md` for historical runs and failures.
All fixes in this checklist are candidate changes, not proof of production rollout.

## Findings to repair

1. The production PostgreSQL data route has no authentication/ownership check.
2. Public data requests can currently create tables and columns.
3. Signup/update metadata can assign privileged roles.
4. Checkout accepts a request-supplied amount and sample merchant fallbacks.
5. The background worker currently waits for shutdown without processing jobs.
6. Storage signs URLs using an internal MinIO hostname.
7. Road-routing failure returns a straight-line geometry and invented travel time.
8. CI and historical documentation still describe a Supabase runtime.

## Launch product

The first revenue journey is a scheduled in-person shoot: discover a vetted
creator, select a package and time, reserve availability, accept the booking,
pay, communicate, fulfil, deliver, reconcile earnings and review. Model bookings
must pass the same contract. Digital purchases remain disabled in store builds
until the applicable native billing flow is implemented and tested.

## Evidence required

Record commit, deployment version, device/browser, role and timestamp for each
test. Test reconnects, expired tokens, concurrent requests, cancellations and
payment webhook replay as well as the successful journey. Do not mark device
tests, live settlement, refunds or store review complete from source checks.
