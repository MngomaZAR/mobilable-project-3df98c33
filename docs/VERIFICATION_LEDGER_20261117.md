# Papzii Verification Ledger

This ledger records evidence for commit `8377ecc0546177ef7921750b24ee23645e1d6d3f` on `codex/qa-hardening-20261117`.

| Area | Status | Evidence |
| --- | --- | --- |
| Backend unit/integration suite | VERIFIED | `375` tests passed; `41` skipped because they require external services. |
| Deployment helper suite | VERIFIED | `46` tests passed under `deployment/tests`. |
| EAS release-gate tests | VERIFIED | `12` Node tests passed. |
| Python compilation and diff hygiene | VERIFIED | `compileall` and `git diff --check` passed. |
| Database outage handling | VERIFIED | Auth and schema-contract failures now return structured HTTP 503 responses. |
| EAS endpoint configuration | VERIFIED | Stale `129.151.188.15` values removed from EAS QA profiles and workflows; builds require `PAPZII_QA_API_URL`. |
| Oracle deployment workflow | VERIFIED | Host and API URL are configuration inputs, not hard-coded legacy infrastructure. |
| Public API `/health` | FAILED | Legacy API URL timed out during this audit. |
| Intended QA API `/health` | FAILED | `papzii-qa.84.12.74.134.nip.io` timed out during this audit; no public runtime is proven. |
| Oracle runtime | NOT TESTED | Direct Cloud Shell/browser session was not available for a fresh SSH deployment in this audit. |
| Mobile device flows | NOT TESTED | Requires a reachable API and real iOS/Android devices. |
| PayFast sandbox | NOT TESTED in this audit | Historical sandbox checkout evidence exists, but was not treated as ITN or production acceptance. |
| Live refunds | BLOCKED | Requires provider acceptance evidence and live read-back. |
| Creator settlement | BLOCKED | Requires an approved settlement provider or documented manual EFT operation. |
| KYC/FICA/POPI end-to-end | NOT TESTED | Code path exists; real identity-document storage, review and deletion evidence remain to be exercised. |
| Video | NOT TESTED | LiveKit credentials, TLS, TURN and device permissions require runtime testing. |
| Instant dispatch | NOT TESTED | Requires realtime transport, routing and independent-role device testing. |
| TestFlight submission | NOT VERIFIED | No current build/submission evidence was produced by this audit. |
| Google Play submission | NOT VERIFIED | No current AAB/internal-track evidence was produced by this audit. |

## Release rule

Only items marked VERIFIED with current runtime evidence may be treated as release evidence. A passing source test, sandbox payment, or successful build does not prove that the public API, webhook, provider settlement, mobile flow or store submission is working.
