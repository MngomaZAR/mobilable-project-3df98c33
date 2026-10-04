# Candidate 871ec85 Deployment Evidence

Date: October 4, 2026. This candidate is deployed for restricted testing, not a
fully accepted public marketplace. Store upload, beta review and public review
are different states.

## Exact Runtime

- Source: `871ec85ac00af86108b3b3525515bbb8d8814cad`.
- Public API: `https://papzii-api.129.151.188.15.nip.io` on Jones Madunga's Oracle.
- API image: `ghcr.io/mngomazar/papzi-api@sha256:2e3c36c5bd605442d2d6188921ffcb21b8c9518de0cd7357895b5ad6ce51c588`.
- Worker image: `ghcr.io/mngomazar/papzi-worker@sha256:7acf7d5a677197c127cd70af35b6c72006ced19243623a1afbb86ccf3ca1f8ff`.
- Rehearsal: `20261004T134106Z`, restored production clone with all 13 migrations.
- Cutover: `20261004T134217Z`; frozen backup digest
  `a5099c43cb473b92a57392a42dc73df5d7ea069eebe826ad07ab037a20450e61`.
- Actual production database, identities, sessions and business records preserved;
  object storage backed up. No QA clone replaced the production database.
- Independent HTTPS checks accepted exact version, schema, 122-point road geometry
  and anonymous-auth rejection. API and worker use the same production database.
- Existing EAS production values already point to this HTTPS API, provider `api`
  and routing `osrm`. No server secret was copied into public mobile variables.
- Unused Docker build cache only was pruned (575.1 MB reported); running container
  IDs, images, volumes and backups were not pruned. Root remains 87% used with
  about 3.4 GB free, so capacity/retention monitoring still needs attention.

## Verified Checks

- GitHub [backend run 37206106153](https://github.com/MngomaZAR/mobilable-project-3df98c33/actions/runs/37206106153)
  passed 349 API and 26 worker tests with PostgreSQL and no skips. Both image
  architectures published successfully.
- Frontend: 349 tests in 33 suites, typecheck and lint passed. Existing React
  VirtualizedList test warnings remain; they were not suppressed.
- Deployment helper tests: 21 passed. Beta-management tests: 13 passed.
- Static audits cover 44 screen files and 146 runtime files; 46 referenced tables
  were checked against 48 live tables without findings. This is contract coverage,
  not proof that every screen or control works on actual devices.
- Load: 300 role sessions, 3,000 reads, zero errors, read p95 1.10 seconds.
  Two hundred booking/chat journeys completed 1,400 requests without errors;
  write p95 4.77 seconds remains above target. Gateways were mocked, not paid.
- Durable worker checks persisted 810 fixture notifications from 811 completed
  jobs, with zero unmapped destinations. Device push is not proven by these rows.
- Matching hosted client web journeys passed sign-in, normal test-account age
  declaration, five tabs and sign-out at phone and desktop widths, without API
  errors, page crashes or horizontal page overflow. No customer account changed.

## Delivered Behavior

Scheduled booking detail can accept/decline requests outside the local cache.
Instant offers use the server dispatch response instead of scheduled acceptance.
Failed notification actions remain retryable and do not falsely acknowledge work.
Booking-linked native calls queue deduplicated participant invitations only after
room/token creation; no token is included in a push payload. SDK-54 production
push registration no longer treats null appOwnership as Expo Go. Notification taps
are recipient-bound and limited to known booking/chat destinations. Permission
grants are account/token-bound and expire; they do not globally enable services.

## Distribution

iOS build 40 and Android code 3 use this exact runtime/app revision. Apple reports
internal/external testing; Play reports code 3 completed on internal testing only.
Two TestFlight instruction emails were accepted by SMTP, including the existing
external tester group containing Jones. Delivery to inbox and device execution
have not been established. See [Testing Release](TESTING_RELEASE_20261004.md)
and sanitized build-40/Play receipts for exact identifiers.

## Public Launch Blockers

Real checkout/refund/creator bank settlement remains unaccepted. Fresh read-only
Oracle inventory found zero bank-account, financial-operation and financial-provider
acceptance rows, and no configured Stitch payout credentials or bank encryption
key. A PayFast checkout key is not bank payout authorization. Physical iPhone and
Android video/push/dispatch acceptance, all-role/all-control coverage, full visual/
accessibility acceptance, security findings, off-host backups and alerting remain
open. No acceptance record, charge, refund, payout or device proof was fabricated.

The five readiness blockers remain checkout activation, refund execution, bank
payout execution, video acceptance and instant-dispatch acceptance. Public Apple
review is not submitted; the Play production track is empty. Neither beta delivery
nor these checks establish Uber/Airbnb-level capability or public-review approval.
