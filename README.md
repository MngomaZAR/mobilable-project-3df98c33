# Papzii

Creator marketplace built with Expo / React Native and an Oracle-hosted FastAPI
backend. PostgreSQL stores application data; media uses an S3-compatible storage
boundary. Oracle's existing storage is MinIO; isolated CI also tests SeaweedFS.
Supabase/Nhost adapters remain for historical compatibility, not the release runtime.

**Public store release remains blocked as of 2026-10-04 (Africa/Johannesburg).**
The tested backend has now been promoted to the existing public Oracle API with
backup/restore and identity-preservation checks. Public schema and road routing
pass; readiness still identifies five unavailable/unaccepted capabilities.
Passing compilation, static audits or `/health` alone does not prove readiness.

| Evidence Level | Current Scope |
|---|---|
| Implemented in source | API auth, owner-scoped data, server-priced bookings, provider commands, media and admin controls; newer financial, dispatch, contract, video and deletion code needs its own acceptance. |
| QA-tested | Candidate `200d605`: 349 API tests / 26 worker tests, no skips; 369 frontend tests / 35 suites, typecheck and lint passed. Scoped web checks accepted sign-in, five tabs, rendered map tiles and sign-out at phone/desktop widths. Load: 300 sessions / 3,000 reads and 200 booking/chat journeys / 1,400 requests, zero errors; write p95 4.34 seconds is still above target. These are not all-screen, physical-device or real-money acceptance. |
| Publicly deployed | Immutable matching API/worker from `200d605`, all 13 migrations, existing production identities/storage preserved after backup/restore rehearsal. Public HTTPS schema, road routing, review summaries and server-derived admin capability pass. SMTP recovery previously reached the owner's inbox; correct PayFast and LiveKit credentials authenticate. General financial/video/dispatch activation remains paused. |
| Store-distributed | Exact-source iOS 1.0.0 (41) is available in both existing TestFlight groups; Android 1.0.0 / code 4 is completed and active on internal testing. Two build-41 tester emails were SMTP-accepted, not confirmed in inboxes. Public Apple review is unsubmitted and Play production is empty. Store distribution is not proof of every feature on actual devices. |

The current phone candidate, Oracle backend and
[hosted web testing preview](https://papzi--swvsndvpq2.expo.app) share revision
`200d60599c92c800ab29bba6eb8b4a4a1b7cfdf6`. Later operational documentation and
release-gate commits do not change those installed binaries. Maps now enter the
server-priced booking flow and display ETA only from validated road routes;
native rendering, permissions and interaction still need device acceptance.

Play Console confirms 0 of 11 app-setup tasks complete and 0 closed-testers.
This personal account requires at least 12 real testers continuously opted in
for 14 days before applying for production access. Internal testing does not
meet that requirement. Public privacy/terms URLs currently return 404, and
the March in-app legal text contains unverified operator, fee, payout and data
retention claims. Do not reuse it as an approved public policy. See
[Public Store Gates](docs/PUBLIC_STORE_GATES_20261004.md).

See [Release Status](docs/RELEASE_STATUS.md) and [Launch Execution](docs/LAUNCH_EXECUTION.md) for current blockers and store
receipts, [October 3 Candidate Evidence](docs/QA_CANDIDATE_FOLLOWUP_20261003.md),
[Earlier QA Report](docs/QA_RELEASE_REPORT_20261003.md) and
[Screen Coverage](docs/SCREEN_COVERAGE_20261003.md). Historical reports describe
their recorded revisions, not the latest working tree.

See [Marketplace Gaps](docs/MARKETPLACE_GAP_ANALYSIS.md),
[Competitive Comparison And Execution](docs/COMPETITIVE_EXECUTION_20261004.md),
[Engineering Handbook](docs/ENGINEERING_HANDBOOK.md) and
[Oracle Release Runbook](docs/ORACLE_RELEASE_RUNBOOK.md). Project-owner attribution:
SAICTS is the contracted builder; Samkelo Mngoma, COO of SAICTS, is the developer
and engineering lead.

## Canonical Architecture

The canonical release path is:

- Expo mobile/web -> authenticated public HTTPS FastAPI -> domain commands ->
  Oracle PostgreSQL / private S3-compatible objects.
- Scheduled booking prices, availability, transitions and payment confirmation
  are server-authoritative; generic data writes cannot replace domain commands.
- PayFast checkout: `/payments/checkout`; notification: `/payments/payfast/itn`.
  Accepting a booking waits for payment; acceptance is not payment confirmation.
  `PAYFAST_CHECKOUT_ENABLED` defaults to false. Merchant configuration cannot
  automatically authorize customer charges; incoming ITN validation is independent.
- Durable background work: PostgreSQL outbox and the worker service.
- Road routes: `/routing/route` -> private OSRM container on Oracle.
- Deployment artifacts: tested API/worker images in GHCR, promoted by verified
  digest with migrations and public contract/readiness checks.
- Release gate: `npm run check:release`, including live schema and capability checks.

Backend revision `200d605` now runs on public Oracle after database-backed CI and
fresh backup/restore rehearsal. iOS 41 and Android code 4 contain its native map
changes. Later source work is not automatically included in installed phone builds. NATS and
Typesense container presence does not prove integrated realtime messaging or
search. Current messaging uses persisted HTTP reads/polling. Refund, payout,
push and LiveKit configuration/implementation are not proof of money movement or
device media delivery. SMTP recovery has one verified live email-delivery journey;
that does not establish all-device reset UX. See
[Integration Recovery](docs/INTEGRATION_RECOVERY_20261004.md).
Current candidate, cutover, test and distribution receipts are in
[Candidate 200d605](docs/RELEASE_CANDIDATE_200D605_20261004.md).
The older [Competitive Release Evidence](docs/competitive-release-20261004.json)
retains its recorded revision, rather than representing the current runtime.

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

## Store Identity

The existing EAS project remains `@papz/papzi` / `f0c1ef90-ac26-4e4c-a799-77b377e2f452`.
iOS targets the confirmed App Store Connect app `6760396864` / `com.papzi.app`.
Android targets the user-confirmed verified Play app `com.papziiii.paparazzi`.
Older `com.saicts.papzi` binaries are separate identities, not interchangeable updates.
The existing EAS upload key was verified against Play's upload certificate and
linked to the confirmed package; the existing submission credential was reused.
Do not regenerate keys or upload a differently identified legacy bundle.
The ignored local `android/` directory is stale (`com.saicts.papzi`) and excluded
from EAS. Its output must not be mistaken for a current-package emulator candidate.

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

Public store validation also checks the existing privacy and terms URLs for
reachable, nonempty HTML without an off-document/login redirect. That availability
check does not establish legal accuracy, account-deletion compliance or approval.
Restricted beta validation is separate and does not claim public readiness.

These checks complement, not replace, device tests, moderation operations and real
payment/refund/payout evidence. Capability readiness deliberately fails while
required services are not implemented, configured or independently accepted.

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
