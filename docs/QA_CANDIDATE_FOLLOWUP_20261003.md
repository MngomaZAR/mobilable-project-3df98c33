# PAPZII Candidate Follow-Up

Date: 2026-10-03. Public release remains blocked; Oracle QA is not a store launch.

## Deployment Identity

- Branch: `release/testflight-2026-06`; baseline `0fe9556` plus the changes described here.
- Host: Jones Madunga's `papzi-prod-a1`, `129.151.188.15`, Johannesburg.
- Isolated source/database: `/opt/papzii-qa-20261003` / `papzii_qa_20261003`.
- Migrations 001-006 applied in QA; previously applied files were not rewritten.
- Latest tested backend archive SHA-256: `EE64B5969F0C2A7D99EB5688AB8EE621633F6D0A30CC12100474AAF7B92D027A`.
- Latest API image manifest list: `sha256:5261ccbc840e05d411e9120e802d9e8b6d64db7030a031d58e2c35f6b3852c51`.
- API port 18000 is Oracle-loopback only. Browser access is a private SSH test tunnel, not laptop production hosting.
- QA secrets exclude real merchant, SMTP, LiveKit and push credentials. Fixtures refuse non-QA databases.
- Existing public API has not been promoted to this candidate. No new signed binary or store submission is claimed.

## Completed Candidate Work

| Area | Change | Evidence and limits |
|---|---|---|
| Authentication | Digest-only session tokens; rotation/revocation; account/IP rate limits; single-use password resets; encrypted mail outbox; native SecureStore persistence. | 15 real-database protocol checks and focused unit tests. SMTP delivery and physical-device storage acceptance are not proven. |
| Pricing | Published photographer/model rates and add-ons form the server quote; expected-total guard; atomic model-service replacement. | Unit/domain checks cover stale quotes and retries. Pending payout records are not bank transfers. |
| Availability | Authenticated atomic online/offline command; approved KYC required; dashboard rollback/error handling. | Real QA role tests. Opening the app no longer makes a provider available automatically. |
| Tracking | Booking participant authorization, paid/accepted/time-window gates, bounded accurate coordinates, expiring fixes; no public live-location writes. | Paid synthetic booking tests verify both participants, outside users, early/stale/completed windows. No native GPS acceptance. |
| Messaging | Stable send IDs; deduplicated retries; durable attachment references; read/delete/react commands; bidirectional blocks and membership. | Real database/MinIO checks; two browser send/read/text-bounds checks passed. HTTP polling is not WebSocket delivery. |
| Media/social/reporting | Stable avatar gateway, fresh signed private media, approved stories/comments, atomic report plus admin case. | Real storage/privacy/report tests; no accepted NSFW scanning/transcoding/operator lifecycle. |
| Settings | Real session list/revoke and sharing; unsupported biometric/2FA/export controls unavailable; truthful deletion-request copy. | Settings and persistence tests. Actual account deletion processing remains missing. |
| Maps | Interactive MapLibre, real OpenFreeMap tiles, Oracle OSRM road geometry, markers/zoom/resize/retry, honest failure states. | Eight browser cases passed, including invalid locations and far-snapped routes. Native map acceptance remains separate. |
| Discovery | Explicit provider/profile queries, normalized published rates, verified-profile ranking; no embedded-query or invented-price fallback. | Unit regressions, web export and four-role browser rerun passed. Ranking is heuristic, not a trained recommendation engine. |
| CI/release | Backend database/load protocols gate GHCR; frontend QA compilation stays private; EAS production readiness guard; candidate branches do not auto-promote production. | Production workflow checks live capabilities, not health alone, and explicitly reports a missing-config no-op. GitHub execution and promotion must be recorded separately. |

## Latest Backend Results

Earlier candidate run started `2026-10-03T17:04:33.505908+00:00`:

- 137 backend unit tests passed.
- 138 real HTTP/domain checks passed; no skipped failures.
- 15 auth protocol checks passed.
- 30 payment/tracking checks passed with real QA PostgreSQL and mocked external gateway responses. No money moved.
- 300 authenticated sessions: 100 clients, 100 photographers, 100 models; 3,000 reads, zero errors, p95 2,165.67 ms.
- 200 concurrent booking/chat journeys: all completed; 1,400 requests, zero errors, per-request p95 7,209.89 ms. Tail latency remains unacceptable for a claim of excellent marketplace responsiveness.
- Durable worker: 8,943 cumulative completed jobs and 8,939 persisted fixture notifications. These are not per-run counts or device push receipts.
- Durban routing: 122 road points, 3.73 km, 450.7 seconds. No live-traffic guarantee.

Exact reports: `qa-role-verified-20261003.json`, `qa-auth-verified-20261003.json`, `qa-payment-verified-20261003.json`.
Earlier archive SHA-256: `6913706A708EDBDCCC4E9401DE899261D41B9E46D8DE5A2F92DFAB2D01412E39`;
API manifest: `sha256:d87b20fc4750a891e0daedb0d331072d26b79cf282550b1f440057105874f636`.

Production backup restore rehearsal also passed: production dump restored to a separate database, then candidate migrations 001-006 and schema checks passed. Backup `/var/backups/papzii/production-20261003T161911Z.dump`, restored database `papzii_qa_restore_20261003T161911Z`. No restored customer database was made public. Encryption, retention and an actual production rollback remain open.

## Frontend And Dependency Evidence

### Patched Oracle Repeat

The patched services were restarted in isolated QA and rerun at `2026-10-03T18:05:15.485443+00:00`:
144 backend units, 138 domain checks, 15 auth checks and 30 mock-gateway payment/tracking checks passed.
All 3,000 reads and 1,400 booking/chat requests passed; 200/200 write journeys completed.
Read p95 was 2,517.52 ms and write per-request p95 was 6,786.46 ms. Worker totals are cumulative:
9,774 done jobs / 9,769 fixture notifications. Performance and actual settlement remain open.

Archive SHA-256: `EE64B5969F0C2A7D99EB5688AB8EE621633F6D0A30CC12100474AAF7B92D027A`.
API image manifest list: `sha256:5261ccbc840e05d411e9120e802d9e8b6d64db7030a031d58e2c35f6b3852c51`.
Exact reports: `qa-role-patched-20261003.json`, `qa-auth-patched-20261003.json`, `qa-payment-patched-20261003.json`.
The earlier archive/results above are retained, not overwritten as though every run used the same image.

- Type checking, full source lint, Expo compatibility check and locked-tree install dry-run passed.
- Final frontend unit run: 14 suites / 96 tests passed. One inherited AppDataContext test is a placeholder, not behavioral coverage; a non-failing VirtualizedList act warning remains.
- Structural inventory: 44 screens, 24 services, zero structural blockers. This is not 44-screen behavioral coverage.
- Six EAS gate-selection regression tests passed.
- Production npm audit reduced from 57 to 39 findings: zero critical, 25 high, 14 moderate. Compatible patches applied; remaining Expo/RN/native/transitive findings require triage and tested upgrades, not a forced SDK-major update.
- MapLibre 6.11.2 replaces the vulnerable version; Expo 54.0.37, local authentication 17.0.9 and React 19.1.0 are aligned.
- First final-candidate browser attempt: 19 passed, 6 failed, retained in `qa-browser-alignment-failed-20261003.json`. Two chat failures were ambiguous hidden-preview selectors; two Home failures were real unsupported embedded queries; two later client failures hit the normal repeated-login account limit. Independent test accounts are now used; production limits were not weakened.
- The next 25-case browser run passed, but manual screenshots exposed an unset `(0,0)` creator pin and clipped unbroken chat text. That report is preserved as `qa-browser-before-visual-fixes-20261003.json`, not accepted as final map/text quality evidence. Marker, road-snap and text-bounds regressions were added.
- Final patched web export is `index-e6178dbad1860e26a87d987729b39f8a.js`. All 27 browser cases passed: 13 role/signup, four settings-entry, eight maps and two chat cases. The real isolated Oracle API and real map tiles/OSRM geometry were used; 96 screenshots were captured. Phone route and long-message screenshots were manually checked after the run. Entry-point coverage is 22/44 modules, not all actions or native devices. Report: `qa-browser-verified-20261003.json`.
- Latest live QA schema audit checked 48 tables and found zero missing table/column contracts. This does not establish every relationship or business rule.
- GitHub CI/GHCR execution is pending at this report revision; do not infer successful publishing from local tests.
- First pushed source commit: `06fe914bce30559f95b86a11ea7c7bc80191898b`. Backend run [37144196586](https://github.com/MngomaZAR/mobilable-project-3df98c33/actions/runs/37144196586) was rejected before jobs: report paths used the unavailable `runner` context in job-level env. They were moved to step env; actionlint 1.7.12 checks all workflows without findings and is now part of CI. The failed attempt is retained, not described as a successful image publish. Context rules: [GitHub reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability).
- Frontend CI [37144197328](https://github.com/MngomaZAR/mobilable-project-3df98c33/actions/runs/37144197328) passed. The next backend run [37144464755](https://github.com/MngomaZAR/mobilable-project-3df98c33/actions/runs/37144464755) passed unit/auth checks but failed pulling `quay.io/minio/minio`; neither `latest`, the documented release tag nor the cached digest could be fetched in the live registry probe. Existing Oracle media continues using its cached image; this is not a reproducible fresh deployment.
- CI now tests a real digest-pinned SeaweedFS 4.48 S3 fixture, not a storage mock. Boto3 remains the common service boundary. Anonymous/wrong-signature denial, non-empty-bucket protection and object/metadata persistence across restart are explicit gates. The separate `docker-compose.seaweedfs-qa.yml` fixture does not mount or replace the production MinIO volume. Production S3 migration, object inventory/checksums, private access and rollback acceptance remain required before switching providers. [MinIO upstream](https://github.com/minio/minio) is archived/unmaintained; [SeaweedFS upstream](https://github.com/seaweedfs/seaweedfs) documents the single-node S3 mode. No automatic production migration is implied.
- The isolated Oracle ARM S3 fixture passed all six signed-access/restart/metadata/delete checks, then was stopped. It used its own Docker network, volume and generated QA credentials; neither the public API nor its storage settings changed. Report: `qa-s3-protocol-20261003.json`. The existing API/browser evidence above still uses cached MinIO; CI's complete role/load checks against SeaweedFS must pass separately.
- Python dependency audit found seven distinct API advisories and four worker advisories, zero critical. Patched FastAPI/Starlette/cryptography pins are under regression testing; one unpatched transitive `ecdsa` advisory requires an explicit non-ECDSA usage assessment. The sanitized resolution audit is not a deployed-image or OS-package SBOM.
- Those Python pins are now applied and passed the Oracle repeat above. Resolved and isolated-installed audits agree: API one known unpatched transitive `ecdsa` advisory; worker zero. No advisories were silently suppressed. Only current RS256 verification / HS256 token creation are found in source; this is a bounded usage assessment, not a claim that the vulnerable dependency has been patched. Evidence: `backend-dependency-audit-20261003.json`.
- The generic `npm run db:migrate` command now targets the FastAPI migration module, not Supabase. Real schema migrations must still run only in the intended server environment with a verified backup.

## Public Release Blockers

1. Real merchant/SMTP configuration and accepted checkout, callback, reconciliation, email recovery and financial incident evidence. Checked live Oracle configuration and usable local values are missing these; GitHub/EAS credential inventories do not establish them.
2. Refund execution and bank payout transfer are not implemented. Video and instant dispatch return unavailable. Contracts/signatures, deletion processing and admin content-queue UI remain incomplete.
3. Native all-screen/actions, camera, microphone, GPS, push, accessibility, reconnect/expiry and actual iPhone/Android paid journeys remain unaccepted. Agency/brand journeys are not covered.
4. Media moderation/processing and operating procedures, a reproducible maintained object-storage deployment/migration, remaining dependency security findings, sustained soak/latency, monitoring/alerts and tested production rollback need completion. Configure and test trusted reverse-proxy client-IP handling before launch: blindly trusting forwarding headers is unsafe, but treating every caller as the proxy IP can throttle legitimate sign-ins together.
5. Public HTTPS production promotion, release env checks, signed TestFlight/Play internal binaries and device testing must precede public submission. Store review cannot be guaranteed by compilation or QA.

No QA loopback bundle may be published. Do not bypass the readiness gate to create the appearance of a successful deployment.
