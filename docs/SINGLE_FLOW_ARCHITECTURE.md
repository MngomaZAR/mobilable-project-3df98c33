# PAPZII Single-Flow Architecture

Updated: 2026-10-04 (Africa/Johannesburg).

## Runtime Boundary

The canonical release runtime is Expo / React Native (and Expo web) calling the
public HTTPS FastAPI API. The API authenticates the actor, checks ownership and
stored role/KYC state, and executes domain commands against Oracle PostgreSQL.
Private media goes through an S3-compatible storage boundary and authorized,
expiring API URLs. Neither the phone nor browser receives database/storage admin
credentials or connects to internal Docker service addresses.

```text
Expo mobile / web
  -> public HTTPS FastAPI
     -> authenticated domain commands -> Oracle PostgreSQL
     -> authorized media gateway -> private S3-compatible storage
     -> road routing -> private Oracle OSRM
     -> configured external payment / email / video services
  PostgreSQL transactional outbox -> worker -> delivery / reconciliation state

GitHub backend QA -> GHCR API + worker images -> reviewed Oracle promotion
```

Existing Oracle storage uses cached MinIO. CI has separately tested a maintained
SeaweedFS S3 fixture; that is not evidence of production object migration.
NATS/Typesense containers are supporting infrastructure, not proof that realtime
messaging or search is integrated. Current messaging uses persisted HTTP polling.
Supabase/Nhost/Hasura adapters and historical function files are compatibility
code, not an alternate production release path.

## Scheduled Booking

1. Discover a creator using published rates and stored availability/KYC state.
2. Fetch booking options and ask `/bookings/quote` for a server-priced quote.
3. Create `/bookings` with retry identity; the server owns prices, slot protection
   and participant identity.
4. The provider accepts through the booking transition command. Acceptance
   reserves the booking while awaiting payment; it is not a paid journey.
5. The client requests `/payments/checkout`. A redirect, screen message or client
   write cannot mark the booking paid.
6. PayFast sends `/payments/payfast/itn`; the server validates the signature,
   amount, provider response and replay before changing payment/booking records.
7. Authorized participants communicate and, where the paid/time-window gates
   permit it, share expiring booking location fixes. OSRM supplies road geometry,
   not live traffic or guaranteed arrival times.
8. Server transitions record fulfilment/completion and earnings. A pending payout
   or earnings row is not a refund, escrow transfer or settled bank payment.

Instant dispatch is a separate booking-backed command, not a mandatory step in
every scheduled booking. Contracts, financial execution and video/deletion
services have newer candidate implementations; their availability and acceptance
must be established independently. Digital purchases stay disabled in store
builds until compliant billing is implemented and verified.

## Domain Commands

These are source contracts, not a claim that all routes are publicly deployed.
Generic `/data/{table}` queries use authentication, owner/public-read policy and
redaction; protected writes must use the relevant command instead.

| Domain | API Boundary / Source |
|---|---|
| Auth and sessions | `/auth/*`; `local_auth.py`, `auth_security.py`; rotation, revocation, session list and recovery/reset commands. SMTP delivery needs configured and tested email infrastructure. |
| Native session persistence | `src/config/apiSession.ts` and `src/services/sessionStorage.ts`: SecureStore on native, browser-compatible storage on web. Source/unit checks do not prove device encryption or biometric enforcement. |
| Provider settings | `/providers/me/model-services`, `/providers/{id}/booking-options`; `provider_settings.py`; server-valid published prices/options. |
| Availability | GET/POST `/providers/me/availability`; `provider_availability.py`; stored owner role, approved KYC to go online, atomic profile/provider update. |
| Booking | `/bookings/quote`, POST `/bookings`, PATCH `/bookings/{id}`; `booking_engine.py`; server quote, idempotency and legal transitions. |
| Payment | `/payments/checkout`, `/payments/payfast/itn`; `payments.py`; authenticated checkout and validated provider notification. |
| Financial operations | `/financial/*`; `financial_operations.py`; owner/admin commands, audit/reconciliation and configuration/acceptance gates. Implemented adapters are not real settlement evidence. |
| Dispatch and contracts | `/dispatch/*`, `/bookings/{id}/contracts`, `/contracts/{id}/sign`; `dispatch_engine.py`, `contracts.py`; actor/booking-scoped state. |
| Location | `/bookings/{id}/location`, `/providers/me/location`; `location_tracking.py`; participant, paid/time-window and fresh-coordinate gates. |
| Media | `/storage/upload`, `/storage/signed-url`, `/storage/object`, `/storage/avatar`; `storage.py`; owned object references and access checks. |
| Social and moderation | `/social/comments`, `/reviews`, `/moderation/reports`, `/admin/moderation/content*`; admin allowlist, required content-decision reasons, audit events and parent/privacy gates. |
| Deletion | `/account/deletion`, `/account/deletion/status`; `account_deletion.py` and worker cleanup. A submitted request is not proof of completed erasure. |
| Video | API function command and `/video-calls/webhook`; `video_calls.py`; paid-booking/participant gates, LiveKit configuration and room lifecycle. Device media delivery remains separate. |

`/functions/{name}` is a compatibility facade in FastAPI. In API mode it must
delegate to the same server implementation; it does not mean the client uses
Supabase edge functions. The legacy `getDefaultPayfastNotifyUrl()` helper is not
the API-mode payment notification contract. `escrow-release` is not a supported
shortcut to bank settlement.

## Persistence And Delivery

`backend/api/migrations` contains append-only, versioned SQL applied by
`python -m backend.api.app.migrate` (also `npm run db:migrate`) in the intended
server environment. Runtime requests must not create schema. Previously applied
migrations 001-006 must not be rewritten; new migrations need independent QA
application/restore checks before production promotion.

`DATABASE_URL` must resolve to the intended Oracle database. The supported
`NEON_DATABASE_URL` override must be checked explicitly so a QA command cannot
silently target a different database. Synthetic protocol tools are restricted
to explicitly isolated `_qa_` databases.

Domain transactions persist background intent in PostgreSQL `job_outbox`.
The worker claims jobs, records attempts and retries/failures, and persists
notification/delivery state. New email, push, room-end and deletion handlers need
their own configured integration tests. Persisted notifications are not physical
device push receipts; a queued email is not a delivered recovery message.

## Build And Promotion

`.github/workflows/build-backend-images.yml` runs `scripts/ci-backend.sh` against
isolated PostgreSQL and S3 fixtures before building/publishing API and worker
images to GHCR for `linux/amd64` and `linux/arm64`.

Production promotion must select reviewed image digests/revision labels, verify
backup/restore and migrations, then verify public `/version`, `/health/contract`,
`/health/readiness` and required domain behavior. `deployment/docker-compose.yml`
is the GHCR deployment definition; older local-build Oracle compose files are not
evidence that the current source has been promoted. Default `latest` tags are
not sufficient release identity. A workflow that skips redeploy is not a rollout.

`npm run check:release` validates release environment, source/tests, live contracts
and web export; the EAS pre-install guard rejects incomplete release targets.
Successful image publication or native compilation does not replace public
acceptance, device testing, merchant settlement or store review.

## Evidence Limits

The October 3 GHCR baseline was deployed to private Oracle QA, not the public API.
Its 27 browser cases cover entry points in 22 of 44 screen modules, not every
control or all native devices. Later working-tree implementations require new
revision-specific evidence. As of the October 4 review, public `/health` is 200
but readiness and routing are 404; current candidate work is not publicly deployed.

See [Launch Execution](LAUNCH_EXECUTION.md) for current release/account blockers,
[October 3 Candidate Evidence](QA_CANDIDATE_FOLLOWUP_20261003.md) for recorded QA
revisions, and [Screen Coverage](SCREEN_COVERAGE_20261003.md) for the 44-screen scope.
