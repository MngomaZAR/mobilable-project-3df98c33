# PAPZII Oracle QA / Release Report

Date: 2026-10-03

This is the earlier baseline report. See [the follow-up candidate report](QA_CANDIDATE_FOLLOWUP_20261003.md)
for subsequent auth, pricing, availability, tracking, chat, maps, dependency and CI changes.
The earlier failures and counts below are retained as history, not the current acceptance totals.

## Decision

**Do not relaunch publicly or submit this candidate for store review yet.**

The scheduled-booking backend is substantially improved and has repeatable QA evidence. The requested all-feature release is not complete: real gateway settlement, bank payouts, refunds, account recovery, video and instant dispatch are not operationally proven or implemented. Passing the tests below is not a claim of Uber, Airbnb or OnlyFans parity.

No GitHub push, public production cutover, EAS release build or store submission was performed in this pass. Candidate API, worker and routing containers were deployed only to isolated Oracle QA. Existing public builds do not receive these uncommitted changes.

## Tested Build And Environment

- Repository HEAD: `0fe9556`, branch `release/testflight-2026-06`, plus uncommitted candidate changes. A clean immutable release commit is still required.
- Actual Oracle host: `129.151.188.15`, `papzi-prod-a1`, Johannesburg; metadata identifies Jones Madunga's tenancy. This is not the older 1 GB micro instance in chat.
- API/worker QA source: `/opt/papzii-qa-20261003`; database: `papzii_qa_20261003`. Fixtures refuse a non-QA database.
- Backend candidate archive SHA-256: `6F7FA1043261BDC996CCC7950DE69077869E84A038125E24CA8814391EF2F7F3`. Frontend edits are covered by the browser export, not that backend archive.
- API image manifest: `sha256:2cec2547e70659dd3afad4deadfa9615ceaa363ab75080bd43318bad23d0fa81`.
- Migrations `202610030001`, `202610030002` and `202610030003` are applied only to QA. Applied files were not rewritten to bypass checksums.
- QA API is bound to the Oracle loopback interface, accessed over an SSH tunnel for browser tests. This is a private test harness, not local production hosting or a public QA deployment.
- Real QA PostgreSQL, MinIO and durable background worker were used. QA has no real payment secrets or Expo push token. Identity documents, people, content and bookings were synthetic fixtures.
- Public production remains `https://papzii-api.129.151.188.15.nip.io`. It was not migrated or replaced.

## Results

| Test | Result | What it proves / does not prove |
|---|---|---|
| Backend security unit tests | 16 passed | Authentication, ownership/privacy scopes, protected money/verification, payment signatures, feed restrictions, provider settings, readiness and schema-cache behavior. Not a penetration test. |
| Four-role HTTP/domain checks | 99 passed on each earlier tuned run; 108 passed on latest candidate | Client, photographer, model and server-allowlisted admin behavior, including signup/profile creation, age declaration, KYC, quotes, booking conflicts, chat, storage, moderation, equipment/services persistence and worker delivery. |
| Concurrent read load, first tuned run | 300 sessions; 3,000 requests; 0 errors; p95 1,843.46 ms | 100 clients + 100 photographers + 100 models reading discovery, feed, bookings, inbox and notifications. Docker-internal HTTP, not 300 phones or cellular networks. |
| Concurrent read load, strict repeat | 300 sessions; 3,000 requests; 0 errors; p95 1,776.36 ms | Independent repeat with no automatic HTTP retries masking errors. |
| Booking/chat load, first tuned run | 200/200 journeys; 1,400 requests; 0 errors; per-request p95 6,416.99 ms | 100 photographer and 100 model bookings: create, retry, accept, chat start, send/read and cancel. No real-money checkout or media calls. |
| Booking/chat load, strict repeat | 200/200 journeys; 1,400 requests; 0 errors; per-request p95 5,547.14 ms | Repeat is successful, but write tail latency is still too high to claim excellent marketplace responsiveness. |
| Latest candidate concurrent load | 3,000 reads and 1,400 booking/chat requests; 0 errors | 300 read sessions; 200/200 booking/chat journeys. Read p95 2,156.38 ms; write per-request p95 6,789.06 ms. Provider settings regression fixes did not eliminate the latency gap. |
| Durable async delivery | All outbox jobs done on three successful runs | 4,875, 5,689 and 6,499 cumulative fixture notifications recorded respectively. This is in-app persistence, not physical-device push or exact per-run notification counts. |
| Payment protocol | 23 passed | Real QA database/API; external gateway `VALID`/`INVALID` responses mocked with dummy merchant credentials. Signature/amount checks, concurrent replay, completion, ledger and pending payout records tested. No funds, refund or bank transfer executed. |
| Road routing | Durban route: 122 geometry points, 3.73 km, 450.7 s | Private South Africa OSRM returns road geometry through QA API. Not proof of native display, traffic estimates or navigation accuracy nationwide. |
| Frontend unit checks | 8 suites, 19 tests passed | Includes session concurrency, booking time, earnings ledger and routing regressions. |
| Expanded browser run | 17 cases passed; 0 skipped/flaky | Four roles at 390x844, 768x1024 and 1440x900, fresh client signup/age gate, plus phone settings entry points. 91 view-state screenshots across 20 unique screen modules; not all 44 screens or all buttons. |
| Browser regression assertions | Passed | No page crashes, unexpected QA backend errors, horizontal overflow or vertically clipped tab labels in tested views; misleading model fan/subscriber panels absent. Does not prove native camera, mic, push or StoreKit/Play Billing. |
| Static source checks | Passed | 44-screen inventory, 23 services, release-provider boundaries, dashboard checks and legacy single-flow checks. These are structural checks, not runtime feature coverage. |
| Live QA schema contract | 48 tables checked, 0 findings | Expected mobile table/column contracts present in candidate schema. Generic relational query semantics still need work. |
| Public release environment validation | Failed as intended | Public health and schema contract return 200; readiness and routing return 404. Candidate code is not publicly deployed. |
| EAS release gate | 6 Node tests passed; simulated production hook fails on the real EAS env | `eas-build-pre-install` checks production/store builds before install/compilation. Local-signing profiles and renamed internal targets cannot bypass the production gate. No cloud build was started. |

The first 17-case expanded browser run started at `2026-10-03T14:43:13.309Z` and completed in approximately 186 seconds. The final rerun started at `2026-10-03T15:02:07.317Z`: 17 passed, 0 skipped/flaky/failed, approximately 211 seconds, 91 screenshots. It validates the subsequent legal-copy and notification-ownership cleanup; no paid transition was clicked in the browser. Exact result: `qa-browser-release-check-20261003.json`. QA bundle: `index-62b393f48e748d044568c9a92f8193a1.js`; its tunnel API URL was verified and the old public production URL is absent. Never publish this QA bundle. The latest 108-check load run started at `2026-10-03T14:40:37.383749Z`.

## Failed Runs Kept In The Evidence

Two earlier write-load runs each completed 199/200 journeys. One had an empty exception message; the better-instrumented repeat reported an HTTPX `ReadError` for a photographer journey. No container OOM or restart was observed. Keep-alive connection closure under load is a hypothesis, not a proven root cause.

The API was changed from one worker/default keep-alive to two workers with a 30-second keep-alive. Both subsequent strict runs completed 200/200 journeys without application retries. Longer soak tests, connection diagnostics and latency optimization remain required.

The first 13-case browser run had 12 passes and one Chromium page-fixture timeout before application interaction. Subsequent reruns, including the final edited UI build, passed all 13. Earlier evidence must not be presented as uniformly successful.

The first settings-entry-point run passed three roles but found `403 /data/photographer_equipment` for the photographer. Fixing the permission boundary also required a unique owner upsert key, JSONB arrays and atomic provider-tier synchronization. The new model service write regression then exposed an ambiguous SQL column in the upsert scope. The qualified scope fix passed on the latest candidate. Both failures were retained rather than ignored or excluded from assertions.

## Before / After

| Area | Previously found | Candidate change and evidence |
|---|---|---|
| Release endpoint | Expo dynamic `process.env[name]` lookup did not inline public configuration; test build contacted the old public host. | Literal public env lookups now compile the intended API host. QA browser tests reject Supabase, Nhost and public production traffic. QA loopback is never a release URL. |
| Auth / profiles | Registration and downstream records could diverge; role metadata was unsafe authority. | Atomic account/profile/provider creation, thread-offloaded password hashing, refresh rotation and server admin allowlist; role tests pass. OAuth remains hidden/unimplemented. |
| Database | Request-time schema changes and permissive generic operations. | Versioned migrations with checksums, typed filters, cached schema introspection, protected ownership and money fields. Not a complete relational Supabase adapter. |
| Booking / pricing | Client totals, inconsistent commission and acceptance confused with payment. | Server quote and 20% accounting, provider slot locks, idempotency, expiry holds, paid/time-gated completion. Arbitrary equipment/services must still be priced authoritatively before launch. |
| Payment callbacks | Unsafe permissive behavior and replay risk. | Fail-closed merchant configuration, signatures, amount checks, external validation and replay-safe locking. Mock protocol tests do not establish gateway settlement. |
| Media / KYC | Internal storage hosts or private data could leak; client verification writes were unsafe. | API media gateway, signed private access, owner/booking-recipient checks, synthetic document upload/review and rejection revocation. Persistent URL renewal and media processing remain incomplete. |
| Messaging / async | Membership and persistence gaps; worker did not provide reliable job execution. | Participant-authorized chat, durable outbox, retries, in-app notification deduplication and unpaid hold expiry. Device push, real-time streams and message-send retry deduplication remain unproven/incomplete. |
| Maps | Straight-line fallback appeared to be road navigation. | Self-hosted OSRM road geometry; fallback never fabricates route geometry or travel time. Web map is still a placeholder; public/native acceptance remains open. |
| Feed | Unapproved content/like writes could bypass rules. | Pending moderation, approved-feed/ranking scopes and protected social commands. Stories, comments and locked media require broader moderation/permission tests. |
| Earnings / UI | Unpaid bookings counted as earnings; fabricated fans and an 85% payout upgrade; clipped navigation labels. | Ledger-based earnings, numeric normalization, no invented fan/upgrade data, disabled digital panels hidden, normal-flow safe-area tab bar; final browser assertions pass. Full accessibility and native appearance acceptance are still open. |
| Provider settings | Equipment API returned 403; upsert key absent; array data stored as text; model service save referenced a missing boolean column. | Migration 003, owner-scoped equipment access, JSONB arrays, unique owner key and tier-sync trigger; equipment/service save/retry/round-trip checks pass. Supported model service types/rates enforced; explicit offerings filtered from API and mobile. Full pricing and atomic service replacement remain open. |
| Notification ownership | Client sent a separate request to an unavailable email function after a successful API booking transition. | API-mode client no longer makes that redundant call. Booking commands already enqueue durable notifications server-side. Email delivery is not implied. |
| EAS dashboard release path | Repository commands checked readiness, but direct dashboard builds could omit them. | Production/store pre-install gate now runs the validator before native compilation. Verified against pulled EAS production variables: blocked on missing public readiness/routing. Custom EAS build definitions need to invoke the hook explicitly. |

## Remaining Release Blockers

These are grouped workstreams, not a claim of an exhaustive defect count.

1. **Real financial operations:** configure the real merchant privately and prove checkout, verified callback, reconciliation, refund and bank settlement. Refund execution and payout transfer are not implemented; pending ledger records are not money sent.
2. **Missing services:** video calls, instant dispatch and account recovery email return unavailable or are missing. Credentials alone do not implement them. Load testing 300 video participants has not occurred.
3. **Screen/backend contract gaps:** generic relation selects/aliases are not implemented; contracts and other feature paths need domain APIs/permissions and write tests. Equipment persistence is now fixed, but add-on/service prices must affect booking quotes authoritatively; multi-request model-service replacement is not atomic. A column inventory passing does not prove these operations.
4. **Trust/media/social gaps:** persistent private-media references/renewal, stories/comments visibility, broader NSFW/report/block/moderation behavior, thumbnails/transcoding, retry-safe message sending and real-device push delivery need completion and acceptance.
5. **Misleading settings controls:** source inspection still finds unimplemented biometric-lock persistence/enforcement, language switching, session list, data export and QR-share behavior. Remove false promises or implement and test these before public release.
6. **UI/device coverage:** 20 screen modules have browser entry-point evidence; 24 remain unaccepted. All meaningful actions, accessibility, native maps, camera/mic, interrupted networks and four-role iPhone/Android journeys need acceptance. Agency/brand-specific journeys are not covered. Web map remains non-interactive.
7. **Operational/security/performance:** sustained soak/peak/recovery tests, rate limiting, secure session storage, production backups/restore, admin payment/support incident resolution, monitoring/alerts and a tested rollback are not established. Write p95 was 5.5-6.8 seconds across successful runs.
8. **Production/store promotion:** public readiness/routing endpoints are absent. After the above, make a clean release commit, back up production, migrate/promote API+worker, align EAS/GitHub variables, test the HTTPS host, build both signed binaries, and obtain TestFlight/Play internal device evidence before public submission.

## Evidence Files

- `qa-role-load-20261003.json` and `qa-role-load-repeat-20261003.json`: final strict load/domain results.
- `qa-role-load-final-20261003.json`: latest candidate with 108 domain checks and provider settings fixes.
- `qa-load-failed-20261003.json` and `qa-load-failed2-20261003.json`: earlier failures.
- `qa-provider-settings-failed-20261003.json` and `qa-settings-20261003.json`: model upsert SQL and equipment UI failures before repair.
- `qa-payment-protocol-final-20261003.json`: latest mock-external-gateway protocol checks; earlier pass in `qa-payment-protocol-20261003.json`.
- `qa-browser-complete-20261003.json` and `qa-browser-release-check-20261003.json`: expanded and final browser results; earlier 13-case evidence also retained.
- `qa-artifacts-20261003/browser-complete/` and `qa-artifacts-20261003/browser-release-check/`: local screenshots. Artifacts/traces are excluded from git because test sessions may appear in them.
- `SCREEN_COVERAGE_20261003.md`: per-screen coverage, including untested/disabled paths.

## Reproduce Safely

Read `deployment/prepare-oracle-qa.sh` and `deployment/update-oracle-qa.sh` before running them. They use the explicitly separate QA database. Never aim destructive fixtures at production.

```powershell
$env:PYTHONPATH='backend/api'
python -m unittest discover -s backend/api/tests -p test_security.py -v
npm run typecheck
npm run lint
npm run test:ci
node --test scripts/tests/eas-release-gate.test.mjs
```

`scripts/ci-backend.sh` applies migrations in an ephemeral CI database, runs the role/load and mock payment checks, and stops test processes on exit. The GHCR workflow requires that test job before image builds. It has not yet been executed in GitHub for this uncommitted candidate.

Browser tests require an explicit QA export, the isolated API tunnel and fixture users. Do not run the production export against `127.0.0.1`. Keep the QA export private and rebuild with a verified hosted HTTPS API for any release.

## Store Content References

The supported API service catalog intentionally excludes explicit offerings. This restriction is enforced server-side, not just hidden for reviewers. Moderation of uploaded content, reporting/blocking, legal text and actual device/store acceptance remain separate work. See [Apple's content and UGC review guidelines](https://developer.apple.com/app-store/review/guidelines/) and [Google Play's inappropriate-content policy](https://support.google.com/googleplay/android-developer/answer/9878810?hl=en). No store approval is guaranteed by these changes.

The native release hook follows [Expo's build lifecycle hook documentation](https://docs.expo.dev/build-reference/npm-hooks/). Custom build definitions do not run these hooks automatically and must call the gate explicitly. A passing software gate still cannot replace store review or external settlement/device evidence.
