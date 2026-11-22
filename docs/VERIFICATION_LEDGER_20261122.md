# Papzii Verification Ledger

This ledger records the sequential release-candidate work performed on
`codex/rc-hardening-20261122`, based on the prior RC evidence branch.

| Gate or control | Status | Evidence | Environment |
| --- | --- | --- | --- |
| Local RPC containment regression test | VERIFIED | `node --test scripts/tests/supabase-rpc-containment.test.mjs`: 3 passed | Local checkout |
| Supabase RPC privilege containment | VERIFIED | 33 monitored functions report `anon_execute=false` and `authenticated_execute=false`; `service_role` remains executable | Supabase `mizdvqhvspkjayffaqqd` |
| Supabase function search paths | VERIFIED | Security advisor no longer reports `function_search_path_mutable` after the trusted-schema migration | Supabase `mizdvqhvspkjayffaqqd` |
| Supabase extension placement | FAILED | `pg_net` remains installed in `public` | Supabase `mizdvqhvspkjayffaqqd` |
| Auth leaked-password protection | NOT VERIFIED | Supabase security advisor reports the setting disabled | Supabase `mizdvqhvspkjayffaqqd` |
| Auth MFA options | NOT VERIFIED | Supabase security advisor reports insufficient MFA options | Supabase `mizdvqhvspkjayffaqqd` |
| Payment integrity reconciliation | BLOCKED | 80 payment rows; 9 completed; 0 provider payment IDs; R15,700 completed amount. Existing rows were not mutated. | Supabase `mizdvqhvspkjayffaqqd` |
| RC public runtime | FAILED | Prior evidence: candidate API timed out; ports 80/443/8000 unavailable; SSH banner timed out | Oracle QA candidate |
| Mobile, provider callbacks, booking, KYC, dispatch, video | NOT TESTED | Blocked by the failed public runtime gate | RC backend |
| Store builds and store submission | NOT ATTEMPTED | Must follow a verified runtime and release manifest | TestFlight / Google Play |

## Release decision

The security exposure is contained, but this branch is not a releasable app.
The public runtime and payment reconciliation gates remain unresolved. No live
money, production-data mutation, or store submission was attempted.
