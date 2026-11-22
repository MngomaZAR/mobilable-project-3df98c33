# Papzii Verification Ledger

This ledger records the sequential release-candidate work performed on
`codex/rc-hardening-20261122`, based on the prior RC evidence branch.

| Gate or control | Status | Evidence | Environment |
| --- | --- | --- | --- |
| Local RPC containment regression test | VERIFIED | `node --test scripts/tests/supabase-rpc-containment.test.mjs`: 3 passed | Local checkout |
| Supabase RPC privilege containment | VERIFIED | 33 monitored functions report `anon_execute=false` and `authenticated_execute=false`; `service_role` remains executable | Supabase `mizdvqhvspkjayffaqqd` |
| Supabase function search paths | VERIFIED | Security advisor no longer reports `function_search_path_mutable` after the trusted-schema migration | Supabase `mizdvqhvspkjayffaqqd` |
| Payment completion guard | VERIFIED | `payments_completed_requires_provider_id` installed; new `completed`/`paid` rows require a nonblank provider ID | Supabase `mizdvqhvspkjayffaqqd` and backend migration |
| Supabase extension placement | FAILED | `pg_net` remains installed in `public` | Supabase `mizdvqhvspkjayffaqqd` |
| Auth leaked-password protection | NOT VERIFIED | Supabase security advisor reports the setting disabled | Supabase `mizdvqhvspkjayffaqqd` |
| Auth MFA options | NOT VERIFIED | Supabase security advisor reports insufficient MFA options | Supabase `mizdvqhvspkjayffaqqd` |
| Payment integrity reconciliation | BLOCKED | 80 payment rows; 9 completed; 0 provider payment IDs; R15,700 completed amount. Existing rows were not mutated; explicit provider reconciliation is still required. | Supabase `mizdvqhvspkjayffaqqd` |
| Dependency failure response | VERIFIED | FastAPI now converts uncaught asyncpg failures to sanitized HTTP 503 responses with `X-Request-ID` and `Retry-After`; mobile API client maps all 5xx responses to a retryable user message. Backend focused suite: 18 passed. | RC source branch |
| Backend pull-request CI | VERIFIED | Backend workflow now runs its isolated PostgreSQL protocol suite on pull requests; image publishing remains push-only. Workflow syntax and frontend CI passed on commit `3977d22`; this workflow change is queued in the next PR run. | GitHub Actions |
| RC public runtime | FAILED | Rechecked 2026-11-22: `https://papzii-qa.84.12.74.134.nip.io/health` timed out; legacy `https://papzii-qa.129.151.188.15.nip.io/health` timed out; `https://papzii.co.za/health` returned the web shell rather than API JSON | Oracle QA candidate / public domain |
| Mobile, provider callbacks, booking, KYC, dispatch, video | NOT TESTED | Blocked by the failed public runtime gate | RC backend |
| Store builds and store submission | NOT ATTEMPTED | Must follow a verified runtime and release manifest | TestFlight / Google Play |

## Release decision

The security exposure is contained, but this branch is not a releasable app.
The public runtime and payment reconciliation gates remain unresolved. No live
money, production-data mutation, or store submission was attempted.
