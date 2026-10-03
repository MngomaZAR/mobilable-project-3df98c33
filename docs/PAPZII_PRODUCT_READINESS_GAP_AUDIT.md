# PAPZII Product Readiness Gap Audit

Date: 2026-10-03

This is the initial gap-analysis baseline, not the latest test ledger. Later
repairs and exact deployment/test evidence are maintained in
[candidate follow-up](QA_CANDIDATE_FOLLOWUP_20261003.md). Unaccepted production and
physical-device items remain open.

## Verdict

PAPZII is not ready for public App Store / Play Store launch yet.

The repo now has a healthier release boundary than before, and the live FastAPI host responds, but the app still does not meet the operational standard implied by "Uber for photography." The correct launch target is a curated first-100-users marketplace, not a fully autonomous mass-market dispatch network.

## What Changed In This Pass

| Area | Before | After |
| --- | --- | --- |
| Release backend boundary | Some runtime utilities still wrote directly to Supabase while release provider was `api`. | Analytics and crash reporting now write through `backendDb`, so release traffic stays behind the FastAPI boundary. |
| Runtime audit | Blocked local endpoints only. | Also blocks direct Supabase/Nhost provider-client imports outside approved adapter files. |
| OAuth buttons | Google/Apple buttons were visible even when the self-hosted API cannot satisfy OAuth. | OAuth buttons are hidden unless `EXPO_PUBLIC_OAUTH_ENABLED=true`. |
| Booking UI copy | Booking form had invalid non-UTF-8 separator bytes that rendered as broken characters. | Booking form is valid UTF-8 and uses clean ASCII separators. |
| Routing gate | Store builds could pass with `router.project-osrm.org`. | Store-targeted release validation now fails if public OSRM demo routing is used. |

## Current Automated Evidence

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run test:ci` | Latest pass: 14 suites, 96 tests; not all-feature coverage |
| `npm run audit:src` | Pass |
| `npm run audit:architecture` | Latest pass: 44 screens, 24 services, 0 structural blockers |
| `npm run audit:release-runtime` | Pass |
| `npm run validate:env:release` | Public release remains blocked: health and schema contract return 200, but readiness and routing return 404. The candidate has not been promoted. API-mode routing now checks the backend rather than requiring duplicate client routing credentials. |

## Benchmark Gap Analysis

| Benchmark expectation | What PAPZII has | Gap to close |
| --- | --- | --- |
| Uber-grade maps and dispatch | Private South Africa OSRM on Oracle; QA returns 122 road-geometry points for the Durban probe, with route distance and travel duration. Interactive web map passes eight road/marker/failure browser tests. Fallback no longer invents roads or travel time. | Production API cutover, native route rendering and live tracking acceptance remain open. Instant dispatch is disabled. |
| Uber Eats-style state machine | Booking states, dispatch functions, ETA snapshots, notification events. | Need live four-role smoke evidence for create booking, payment, provider accept/reject, tracking, completion, review, payout. Need operator intervention path for unaccepted jobs. |
| Airbnb-style trust and booking confidence | Age gate, KYC screens, profile records, reviews, support, legal docs. | Need proven availability conflict checks, cancellation/refund rules visible in-app, complete provider verification workflow, and review/report moderation evidence. |
| Instagram-style feed | Feed, stories, likes, bookmarks, comments, For You ranking hooks, reporting/blocking. | Feed quality is not yet proven visually or operationally. Fallback story content and cached/fallback posts must not create fake liquidity. Need visual QA on real devices and moderation/NSFW controls verified. |
| Creator monetization / OnlyFans-style controls | Premium unlock records, media library, subscriptions, tips, credits, paid calls, payout methods. | Store builds disable digital purchases unless IAP is implemented. External PayFast is only safe for real-world bookings, not app-consumed digital content. Need IAP or hard-disabled digital monetization in store builds plus clear review notes. |
| Admin and operations | Admin dashboard/moderation screens, support tickets, manual fallback docs. | Week-1 operator dashboard is still mostly a plan. Need a usable queue for KYC, booking incidents, payment mismatches, payouts, reports, and support SLAs. |

## Product Standard For Launch

The launch bar should be:

1. Client can sign up, create profile, search, book, pay, chat, navigate, complete, and review.
2. Photographer can sign up, verify identity, set availability, receive booking, accept/reject, navigate, deliver, get paid, and view earnings.
3. Model can sign up, verify identity, manage profile/services/media, receive booking, chat, and get paid.
4. Admin can review KYC, moderate content, resolve payment/booking incidents, handle reports, and see at-risk bookings.
5. All flows use the same deployed API host and production database.
6. Maps use road-following production routing, not straight-line fallback during normal use.
7. Store builds hide or disable features that are not policy-ready; unsupported explicit model offerings must also be rejected server-side.

## Immediate Engineering Plan

| Priority | Work | Done when |
| --- | --- | --- |
| P0 | Promote verified private Oracle routing through the public API. | Release routing probe passes with real geometry; native display is accepted on both platforms. |
| P0 | Run real-device four-role smoke test against the latest TestFlight/Android internal build. | Evidence captured for client, photographer, model, admin flows. |
| P0 | Confirm Play app/package/signing alignment. | `com.saicts.papzi` AAB uploads and reaches internal testing without optimization/signing failure. |
| P0 | Confirm iOS identity and Sign in with Apple alignment. | Bundle ID, Apple Sign In key, provisioning, and TestFlight build all target the same App Store record. |
| P1 | Update stale docs from Supabase-era launch to FastAPI/Dokploy launch. | README and deployment docs describe one current architecture. |
| P1 | Build operator dashboard minimum. | Admin can see KYC queue, at-risk bookings, payments/payouts, reports, and support incidents. |
| P1 | Visual QA pass on the 44 screens. | Screenshots on iPhone and Android show no clipped text, broken characters, dead buttons, or misleading features. |
| P2 | Feed quality and moderation pass. | Report/block/moderation path verified, fallback fake content removed or marked as demo-only. |

## Release Decision

The 2026-10-03 Oracle tests cover real data/storage and 300 authenticated sessions,
not 300 video calls or real-money users. Two intermediate write-load runs failed
one journey each; their reports were preserved. Later server-tuned repeats must
not be presented as proof of all-screen, device or settlement readiness. Full
screen coverage and remaining gaps are in `SCREEN_COVERAGE_20261003.md`.

Latest evidence: 144 backend units, 138 domain checks, 15 auth protocol checks,
30 mock-external-gateway payment/tracking checks and 27 browser cases. Browser
entry points cover 22/44 modules, not every action. The latest load has zero
errors but per-request write p95 is 6.79 seconds; tail latency still needs
improvement. Earlier permission, SQL, discovery, invalid map pin and clipped chat
failures were repaired with regressions; failure artifacts were retained.

Do not submit for public review until `npm run validate:env:release` passes and real-device smoke tests are recorded. TestFlight/internal testing is acceptable only for controlled QA, with clear known blockers.
