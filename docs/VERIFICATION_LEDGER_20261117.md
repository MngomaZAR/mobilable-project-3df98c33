# Papzii Verification Ledger

This ledger records evidence for the RC audit branch `codex/rc-gates-20261117`, branched from PR #32 head `621e8111650980a99b3088fe0a59a326392bc0a0`.

| Area | Status | Evidence |
| --- | --- | --- |
| Backend unit/integration suite | VERIFIED | `375` tests passed; `41` skipped because they require external services. |
| Deployment helper suite | VERIFIED | `46` tests passed under `deployment/tests`. |
| EAS release-gate tests | VERIFIED | `12` Node tests passed. |
| Python compilation and diff hygiene | VERIFIED | `compileall` and `git diff --check` passed. |
| Database outage handling | VERIFIED | Auth and schema-contract failures now return structured HTTP 503 responses. |
| EAS endpoint configuration | VERIFIED | Stale `129.151.188.15` values removed from EAS QA profiles and workflows; builds require `PAPZII_QA_API_URL`. |
| Oracle deployment workflow | VERIFIED | Host and API URL are configuration inputs, not hard-coded legacy infrastructure. |
| G0 public DNS | VERIFIED | `papzii-qa.84.12.74.134.nip.io` resolved to `84.12.74.134`; legacy `papzii-api.129.151.188.15.nip.io` resolved to `129.151.188.15`. Windows DNS resolution evidence collected 2026-11-17. |
| G0 network reachability | FAILED | `84.12.74.134:22` accepted TCP, but `:80`, `:443` and `:8000` did not. The legacy host also did not expose a usable API port. |
| G0 SSH/runtime access | FAILED | SSH connected at TCP level but timed out during banner exchange with `Connection timed out during banner exchange`; no host command could be executed. |
| Public API `/health` | FAILED | Intended QA HTTPS URL timed out; no HTTP status or JSON health response was received. |
| Intended QA API `/health/contract` | NOT TESTED | Blocked by the failed public runtime gate. |
| Intended QA API `/health/readiness` | NOT TESTED | Blocked by the failed public runtime gate. |
| Oracle runtime | BLOCKED | OCI instance/container/migration state could not be inspected because SSH did not complete and no authenticated OCI session was available in this audit. |
| Mobile device flows | NOT TESTED | Requires a reachable API and real iOS/Android devices. |
| PayFast sandbox | NOT TESTED in this audit | Historical sandbox checkout evidence exists, but was not treated as ITN or production acceptance. |
| Live refunds | BLOCKED | Requires provider acceptance evidence and live read-back. |
| Creator settlement | BLOCKED | Requires an approved settlement provider or documented manual EFT operation. |
| KYC/FICA/POPI end-to-end | NOT TESTED | Code path exists; real identity-document storage, review and deletion evidence remain to be exercised. |
| Video | NOT TESTED | LiveKit credentials, TLS, TURN and device permissions require runtime testing. |
| Instant dispatch | NOT TESTED | Requires realtime transport, routing and independent-role device testing. |
| TestFlight submission | NOT VERIFIED | No current build/submission evidence was produced by this audit. |
| Google Play submission | NOT VERIFIED | No current AAB/internal-track evidence was produced by this audit. |

## RC gate decision

G0 is **FAILED/BLOCKED**. Per the mission circling rule, no retry was made after the bounded DNS/TCP/SSH diagnostic: the evidence is sufficient to distinguish DNS (working) from runtime service availability (not working). G1-G8 remain unexecuted because they require a reachable RC backend.

## Release rule

Only items marked VERIFIED with current runtime evidence may be treated as release evidence. A passing source test, sandbox payment, or successful build does not prove that the public API, webhook, provider settlement, mobile flow or store submission is working.
