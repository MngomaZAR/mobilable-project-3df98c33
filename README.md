# Papzii

Creator marketplace built with Expo / React Native and an Oracle-hosted FastAPI
backend. PostgreSQL stores application data; MinIO stores media. Supabase/Nhost
adapters remain for historical compatibility, not the release runtime.

**Public release is blocked.** See [Current Candidate Report](docs/QA_CANDIDATE_FOLLOWUP_20261003.md),
[Earlier QA Release Report](docs/QA_RELEASE_REPORT_20261003.md)
and [Screen Coverage](docs/SCREEN_COVERAGE_20261003.md). Passing compilation,
static audits or `/health` alone does not establish marketplace readiness.

## Canonical Architecture

Papzii now enforces a single-flow runtime architecture:

- Mobile -> authenticated HTTPS API -> domain services -> PostgreSQL / MinIO.
- Scheduled booking prices, availability, transitions and payment confirmation
  are server-authoritative in the tested candidate.
- PayFast checkout: `/payments/checkout`; notification: `/payments/payfast/itn`.
- Durable background work: PostgreSQL outbox and the worker service.
- Road routes: `/routing/route` -> private OSRM container on Oracle.
- Release gate: `npm run check:release`, including live schema and capability checks.

The candidate runs in an isolated Oracle QA database. Its fixes have **not** been
promoted to the existing public API or submitted as new store builds. NATS and
Typesense containers exist but their presence is not proof of integrated realtime
messaging or search. Current messaging uses persisted HTTP reads/polling.

Supporting docs:

- `docs/SINGLE_FLOW_ARCHITECTURE.md`
- `docs/FIRST_100_USERS_OPERATIONS.md`
- `docs/MONITORING_DASHBOARD_PLAN.md`
- `docs/MANUAL_FALLBACK_OPS.md`

## Core Product Scope

- Discovery: photographers and models
- Map and location screens; native route rendering still needs device acceptance
- Scheduled booking flow with server quotes and conflict protection
- Chat and conversation threads
- Feed and profile interactions
- Payment protocol checks; actual gateway settlement and bank payouts are blocked
- Admin and compliance screens

## Environment

Create a `.env` from `.env.example` and set:

- `EXPO_PUBLIC_BACKEND_PROVIDER=api`
- `EXPO_PUBLIC_API_BASE_URL=https://<verified-public-api-host>`
- `EXPO_PUBLIC_STORE_TARGET=both`
- `EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER=disabled`
- `EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=true`
- `EXPO_PUBLIC_OAUTH_ENABLED=false` until OAuth is implemented and verified

Keep database, MinIO, payment, push and routing credentials on the server. API-mode
mobile routing does not require a public OSRM URL or an ORS secret. Public Expo
variables are compiled into the application and must never contain server secrets.
Reuse the existing EAS/GitHub credentials rather than creating duplicate accounts.

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

```bash
pip install -r backend/api/requirements.txt
PYTHONPATH=backend/api python -m app.migrate
PYTHONPATH=backend/api:backend python -m unittest discover -s backend/api/tests -p 'test_*.py' -v
```

`backend/api/tests/role_load.py` is destructive fixture tooling and refuses any
database not explicitly named `_qa_`. It tests 100 clients, 100 photographers and
100 models through real HTTP, PostgreSQL and storage. The payment protocol suite
mocks the external PayFast validation response and does not transfer money.

`npm run db:migrate` now targets the FastAPI versioned migrations using the server's
explicit `DATABASE_URL` / `NEON_DATABASE_URL`. Run it only in the intended server
environment with a backup. The `supabase:*` commands are legacy tools, not the
production database deployment path.

`scripts/ci-backend.sh` runs isolated backend checks before GHCR images are built.
Oracle QA provisioning/update scripts are under `deployment/`. Never point them
at the production database. Local previews and SSH tunnels are test tools, not
production hosting.

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

- The app keeps all planned UX surfaces (map/home/bookings/chat/profile) and does not remove product features.
- Older Supabase smoke/migration scripts do not test the Oracle release backend.
- Do not overwrite a production migration after it has been applied; add a new
  versioned migration and back up the database before promotion.
- TestFlight/internal availability is separate from App Store/Play public approval.
