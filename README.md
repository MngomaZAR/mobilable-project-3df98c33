# Papzii

Creator marketplace built with Expo / React Native and an Oracle-hosted FastAPI
backend. PostgreSQL stores application data; media uses an S3-compatible storage
boundary. Oracle's existing storage is MinIO; isolated CI also tests SeaweedFS.
Supabase/Nhost adapters remain for historical compatibility, not the release runtime.

**Public release is blocked as of 2026-10-04 (Africa/Johannesburg).** The existing
public backend still returns `/health` 200 but `/health/readiness` and
`/routing/route` 404. Current candidate work has not been promoted to it.
Passing compilation, static audits or `/health` alone does not prove readiness.

| Evidence Level | Current Scope |
|---|---|
| Implemented in source | API auth, owner-scoped data, server-priced bookings, provider commands, media and admin controls; newer financial, dispatch, contract, video and deletion code needs its own acceptance. |
| QA-tested | The October 3 isolated Oracle/GHCR baseline passed backend protocols and 27 browser cases, with entry-point evidence for 22 of 44 screen modules. This does not certify later source changes or all buttons. |
| Publicly deployed | Existing older backend only; candidate fixes are not publicly deployed. |
| Device/store-proven | Historical iOS build 38 and Android build 13 finished September 23. They do not prove the current source, physical-device journeys or public approval. Current Apple/Google account blockers remain. |

See [Launch Execution](docs/LAUNCH_EXECUTION.md) for current blockers and store
receipts, [October 3 Candidate Evidence](docs/QA_CANDIDATE_FOLLOWUP_20261003.md),
[Earlier QA Report](docs/QA_RELEASE_REPORT_20261003.md) and
[Screen Coverage](docs/SCREEN_COVERAGE_20261003.md). Historical reports describe
their recorded revisions, not the latest working tree.

## Canonical Architecture

The canonical release path is:

- Expo mobile/web -> authenticated public HTTPS FastAPI -> domain commands ->
  Oracle PostgreSQL / private S3-compatible objects.
- Scheduled booking prices, availability, transitions and payment confirmation
  are server-authoritative; generic data writes cannot replace domain commands.
- PayFast checkout: `/payments/checkout`; notification: `/payments/payfast/itn`.
  Accepting a booking waits for payment; acceptance is not payment confirmation.
- Durable background work: PostgreSQL outbox and the worker service.
- Road routes: `/routing/route` -> private OSRM container on Oracle.
- Deployment artifacts: tested API/worker images in GHCR, promoted by verified
  digest with migrations and public contract/readiness checks.
- Release gate: `npm run check:release`, including live schema and capability checks.

The previously verified candidate runs in isolated Oracle QA. Later source work
is not automatically included in that image or its test evidence. NATS and
Typesense container presence does not prove integrated realtime messaging or
search. Current messaging uses persisted HTTP reads/polling. Refund, payout,
SMTP recovery, push and LiveKit configuration/implementation are not proof of
money movement, delivered email or device media delivery.

Supporting docs:

- [Single-Flow Architecture](docs/SINGLE_FLOW_ARCHITECTURE.md)
- [First 100 Users Operations](docs/FIRST_100_USERS_OPERATIONS.md)
- [Monitoring Plan](docs/MONITORING_DASHBOARD_PLAN.md)
- [Manual Fallback Operations](docs/MANUAL_FALLBACK_OPS.md)

## Core Product Scope

- Discovery: photographers and models
- Map and location screens; native route rendering still needs device acceptance
- Scheduled booking flow with server quotes and conflict protection
- Chat and conversation threads
- Feed and profile interactions
- Payment protocol checks; actual payment, refund and bank settlement need separate evidence
- Admin and compliance screens

The business scope remains 44 screen modules across client, photographer, model
and administrator journeys. Screen inventory, screen opening and successful
button actions are different coverage levels. Native GPS, camera/microphone,
session persistence, push, accessibility and end-to-end paid journeys still need
physical iPhone and Android acceptance.

## Environment

Create a `.env` from `.env.example` and set:

- `EXPO_PUBLIC_BACKEND_PROVIDER=api`
- `EXPO_PUBLIC_API_BASE_URL=https://<verified-public-api-host>`
- `EXPO_PUBLIC_STORE_TARGET=both`
- `EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER=disabled`
- `EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=true`
- `EXPO_PUBLIC_OAUTH_ENABLED=false` until OAuth is implemented and verified

Keep database, S3, payment, push, SMTP and routing credentials on the server. API-mode
mobile routing does not require a public OSRM URL or an ORS secret. Public Expo
variables are compiled into the application and must never contain server secrets.
Reuse the existing EAS/GitHub credentials rather than creating duplicate accounts.
Do not publish loopback URLs, SSH tunnels or private QA configuration. Production
requires a verified public backend, not merely the correct provider setting.

## Run

```bash
npm install
npm run start
```

Platform shortcuts:

- `npm run web`
- `npm run android`
- `npm run ios`

## Launch Checks

Run the full launch gate:

```bash
npm run check:release
```

This runs:

1. Type check
2. Lint
3. Unit tests
4. Source connectivity audit
5. Live database/schema and capability checks
6. Dashboard and single-flow source audits
7. Web export build

These checks complement, not replace, device tests, moderation operations and real
payment/refund/payout evidence. Capability readiness deliberately fails while
required services are not implemented or configured.

## Backend QA

From PowerShell at the repository root:

```powershell
python -m pip install -r backend/api/requirements.txt
$env:PYTHONPATH = "backend/api;backend"
python -m unittest discover -s backend/api/tests -p 'test_*.py' -v
```

On POSIX shells, use `PYTHONPATH=backend/api:backend` for the test command instead.

`backend/api/tests/role_load.py` is destructive fixture tooling and refuses any
database not explicitly named `_qa_`. It tests 100 clients, 100 photographers and
100 models through real HTTP, PostgreSQL and storage. Use a separate QA environment
with no production database override or real gateway credentials. The payment
protocol suite mocks external PayFast validation and does not transfer money.

`npm run db:migrate` now targets the FastAPI versioned migrations using the server's
explicit `DATABASE_URL` / `NEON_DATABASE_URL`. Run it only in the intended server
environment with a backup. The `supabase:*` commands are legacy tools, not the
production database deployment path.

`scripts/ci-backend.sh` runs isolated backend checks before
`.github/workflows/build-backend-images.yml` publishes API/worker images to GHCR
for AMD64/ARM64. A publish is not a rollout. Oracle QA provisioning/update scripts
are under `deployment/`; production promotion requires a reviewed image identity,
backup/migrations, public smoke checks and rollback evidence. A green deployment
workflow that skips redeploy is not deployment evidence. Local previews and SSH
tunnels are test tools, not production hosting.

## Useful Scripts

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run audit:src`
- `npm run audit:single-flow`
- `npm run audit:deployed:functions`
- `npm run build:web`
- `npm run preview:web` (serve exported `dist` at local preview URL)

## Notes

- Unsupported or unaccepted controls must be unavailable or truthful, not no-op promises.
- Older Supabase smoke/migration scripts do not test the Oracle release backend.
- Do not overwrite a production migration after it has been applied; add a new
  versioned migration and back up the database before promotion.
- TestFlight/internal availability is separate from App Store/Play public approval.
