# Service Activation And Acceptance

## Release Boundary

Oracle hosts the maintained API, database and worker. GitHub builds immutable
images; EAS delivers the native app. This change does not introduce another auth
provider, database or registry, and does not migrate production users.

The public readiness endpoint is not a substitute for physical-device, financial,
moderation or all-screen acceptance. Do not manufacture acceptance records to pass
a release check. A configured merchant or LiveKit account is not settlement/media
evidence. App Store and Play review are separate from backend deployment.

## Controlled Tests

Server-only `SERVICE_ACCEPTANCE_USER_IDS` names at most 20 verified, active test
accounts. `SERVICE_ACCEPTANCE_EXPIRES_AT` must include a timezone and expire within
24 hours. Configure through the guarded Oracle configuration helper, not EAS
public variables. No public access is granted by a controlled test.

- Both the client and creator must be named for checkout and booking video.
- Matching excludes creators outside the named cohort.
- Checkout is capped at R50 by default; root configuration may set R5-R500.
- Use separately identified test profiles with published prices within the cap.
  Do not change a real creator's price to make a test fit.
- Payout execution still requires independently accepted live payout evidence.
- ITNs, room ending, offer declines and reconciliation remain available while new
  service creation is paused.
- Expire access to stop new tests. Check outstanding payments/rooms and reconcile
  them; disabling access does not erase transactions or claim refunds.

Authenticated `GET /auth/service-access` returns account-specific availability
with `Cache-Control: no-store` and at most a 60-second lifetime. Mobile grants are
memory-only, token-bound, cleared during session changes, and do not override
server checks. Old installed binaries do not contain this new client behavior.

## Booking Order

Scheduled: server quote -> pending request -> creator acceptance -> checkout ->
verified ITN -> shoot -> completed delivery -> independently approved settlement.

Instant: server quote with `prepare_dispatch=true` -> pending unpaid reservation
-> matching offers -> creator accepts an offer -> checkout -> verified ITN.
Preparation does not notify the initially selected creator as a scheduled request.
Unstarted preparation holds expire after five minutes. Matching owns assignment
and pricing; the phone never patches those protected columns. Failed matching can
be retried from booking detail without creating or paying a second booking.

## Native Acceptance Archive

Retain actual iPhone and Android reports in `/var/backups/papzii/acceptance`, owned
by root, mode 0600, including their SHA-256 digests. Reports must identify the
physical devices, OS versions, native build IDs, exact candidate revision,
timestamp and real outcomes. An emulator is useful QA, not physical-device proof.

Video cases: two-way media, denied permissions, reconnect, room termination,
unauthorized access and push delivery. Dispatch cases: photographer and model
matching, concurrent acceptance, offer expiry, stale location, push delivery,
road navigation and the paid booking journey. Every case must pass on each device.

The operator prepares a `ServiceEvidence` JSON document from those results and
executes the API module `app.record_service_acceptance` against the running
production candidate. Required arguments: `--evidence`, `--ios-report`,
`--android-report`, `--id`, `--reviewer-id`, `--expected-revision`. The default is
dry-run; `--apply` records reviewed evidence only. Registration also requires a
matching ended/connected video room or completed, live-paid dispatch booking.
The CLI does not activate services. It must run in an image with the production
database configuration and read-only archive mounts; keep credentials off CLI
arguments and terminal output.

Booking detail is the native call entry point for both participants of an accepted
physical-service booking. Room creation queues a deduplicated invitation only
after the LiveKit room and media token succeed; push payloads contain booking and
session references, never media tokens. Tapping the notification opens booking
detail, where access is checked again before joining. Native push registration uses
SDK 54's execution environment, not the deprecated null `appOwnership` value.
Cold-start and foreground push responses are restricted to the signed-in recipient
and known booking/chat routes; arbitrary URLs and cross-account payloads are ignored.

In-app notifications refresh while mounted, retain failed actions, and persist
read/dismissed state on the server. Viewing an instant offer does not accept or
consume it. Scheduled requests can be accepted or declined in booking detail,
including requests outside the local booking cache. Instant offers must use their
dedicated server dispatch response, not scheduled acceptance.

Records are server-only, immutable by ID, revision/endpoint/reviewer-bound, expire
after 30 days and can be revoked. Reports cannot be future-dated or older than
seven days at review. Deploying a different source revision invalidates service
acceptance until the new candidate is accepted. Missing/revoked evidence or a
database error fails closed.

## Public Activation

1. Pass CI with real PostgreSQL, rehearse backup/restore, and deploy exact images.
2. Complete the controlled native journeys and retain genuine reports.
3. Review and register service evidence; configure `VIDEO_ACCEPTANCE_ID` with
   `LIVEKIT_ENABLED=true`, and `DISPATCH_ACCEPTANCE_ID` with
   `INSTANT_DISPATCH_ENABLED=true` through guarded preflight.
4. Complete real checkout, refund and creator bank settlement, including ledger
   reconciliation, merchant ownership and authorized payout-provider funding.
   A PayFast checkout key alone cannot transfer to creator bank accounts.
5. Public checkout requires accepted live refunds AND creator settlement. Enabling
   `PAYFAST_CHECKOUT_ENABLED` alone is insufficient.
6. Verify public probes, role journeys, interruption/permission cases, accessible
   screens and controls, incident/rollback procedures and actual phone builds.
7. Complete store declarations, reviewer access and submission. Do not describe a
   TestFlight upload or Play internal draft as a public release.

No live charge, payout, device report or store approval is fabricated by the tests
in this change. Financial protocol tests use explicitly isolated mock gateways.

Primary integration references:
- https://docs.expo.dev/versions/v54.0.0/sdk/constants/
- https://docs.expo.dev/versions/v54.0.0/sdk/notifications/
- https://docs.livekit.io/frontends/reference/tokens-grants/
- https://docs.expo.dev/submit/android/
