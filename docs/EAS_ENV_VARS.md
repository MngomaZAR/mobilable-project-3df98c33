# EAS / CI Environment Variables (Launch Lock)

These variables are now enforced by `scripts/validate-env.mjs`.

Production/store native builds also invoke that validator through the
`eas-build-pre-install` hook in `package.json`, including direct dashboard builds.
The inherited local-signing production profile cannot skip readiness by changing
the store target. Custom EAS build definitions must explicitly call
`node scripts/eas-release-gate.mjs`; see [Expo build hooks](https://docs.expo.dev/build-reference/npm-hooks/).
The hook was verified locally against the pulled EAS production environment, not
by starting another cloud build. HTTPS and literal boolean billing flags are
required; the QA tunnel cannot pass the release gate.

## Legacy provider variables

| Variable | Required | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | No for release | Legacy/reference Supabase project URL. Ignored when `EXPO_PUBLIC_BACKEND_PROVIDER=api`. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | No for release | Legacy/reference Supabase anon key. Ignored when `EXPO_PUBLIC_BACKEND_PROVIDER=api`. |
| `EXPO_PUBLIC_NHOST_SUBDOMAIN` | No for release client logic | Public Nhost identifier. It may be present for migration, but release traffic must still go through the FastAPI API boundary. |
| `EXPO_PUBLIC_NHOST_REGION` | No for release client logic | Public Nhost region. Server-side Nhost credentials belong in Dokploy/API env, not in the mobile binary. |

## Required for release builds (`validate:env:release`)

| Variable | Required | Allowed values | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Yes | Hosted HTTPS URL | Must point to the deployed Oracle FastAPI API. Public DNS, `/health`, `/health/contract`, `/health/readiness` and the backend road-route probe must pass for public store targets. A successful health check alone does not establish release readiness. |
| `EXPO_PUBLIC_BACKEND_PROVIDER` | Yes | `api` | Store builds must use the deployed API boundary, not direct Nhost or Supabase calls. |
| `EXPO_PUBLIC_STORE_TARGET` | Yes | `development`, `web`, `internal`, `appstore`, `play`, `both` | Which storefront this build targets |
| `EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER` | Yes | `iap`, `external`, `disabled` | Digital billing mode in-app |
| `EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES` | Yes | `true` / `false` | Hard kill-switch for digital purchases |
| `EXPO_PUBLIC_ROUTING_PROVIDER` | No for API mode | `osrm`, `ors` | Legacy direct-routing selection. With provider `api`, mobile calls `/routing/route` on the API instead. |
| `EXPO_PUBLIC_OSRM_BASE_URL` | No for API mode | Hosted HTTPS URL | Only needed by legacy direct-routing clients. Do not put a Docker hostname or a local Oracle port in a mobile release. |
| `EXPO_PUBLIC_OPENROUTESERVICE_API_KEY` | No for API mode | API key | Only for legacy direct-routing clients. Do not add a duplicate public routing key to solve an API-mode backend failure. |
| `EXPO_PUBLIC_OAUTH_ENABLED` | No | `true` / `false` | Keeps Google/Apple buttons hidden until OAuth is configured behind FastAPI and smoke-tested. |

## Compliance guard enforced

For `appstore`, `play`, or `both` targets:

- If `EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=false`, then `EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER` must be `iap`.
- Otherwise, build fails.

This guards against exposing external digital checkout in store builds. It is not proof of Apple or Google policy approval; IAP, metadata, moderation and device acceptance still require separate evidence.

For legacy direct-routing store builds, `EXPO_PUBLIC_OSRM_BASE_URL=https://router.project-osrm.org` is blocked. In API mode, the validator probes the backend route rather than requiring client routing credentials.

## Server-only configuration

Manage these in the Oracle/Dokploy environment, not in EAS public variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Production PostgreSQL connection; QA must use a separate database. |
| `ALLOW_RUNTIME_SCHEMA_CHANGES=false` | Production schema changes use versioned migrations, never request-time DDL. |
| `API_PUBLIC_URL` | HTTPS callback and media gateway base URL reachable by devices and providers. |
| `OSRM_BASE_URL` | Private Docker service URL such as `http://papzii-osrm:5000`. Only the API contacts it. |
| `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | Private object storage connection and credentials. Devices use the authenticated API media gateway. |
| `ADMIN_USER_IDS` | Explicit server-side admin allowlist; client metadata is not admin authority. |
| `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE` | Merchant configuration. An existing checkout UI or mock callback test does not prove a real payment or settlement. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SSL`, `RECOVERY_ENCRYPTION_KEY` | Server-only recovery email; API and worker share a valid Fernet key. Actual mail delivery and reset acceptance are required, not just configured fields. |
| `EXPO_ACCESS_TOKEN` | Optional server-side authenticated Expo push delivery. Never use an `EXPO_PUBLIC_` prefix. |

Do not assume that placing LiveKit, SMTP or payout credentials in an environment completes the missing service implementations. `/health/readiness` reports those gaps explicitly.

## Audit status: 2026-10-03

- The private Oracle QA candidate passed schema, storage and real road routing checks.
- EAS production variables were inspected without printing secrets. They still target the existing public API, not the QA tunnel or candidate.
- The existing public API returns 200 for health and schema contract, but 404 for readiness and road routing. Public release validation fails.
- No EAS production-variable update or store submission was made in this QA pass. Do not publish the QA web export: its loopback URL is intentionally restricted to the browser test tunnel.
- Full current evidence and remaining blockers: [candidate follow-up](QA_CANDIDATE_FOLLOWUP_20261003.md); earlier runs are in the [historical QA report](QA_RELEASE_REPORT_20261003.md).
