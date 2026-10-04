# Papzi Competitive Execution

Assessment: 2026-10-04. Owner: SAICTS engineering, Samkelo Mngoma.
This is a product and engineering comparison, not access to competitors' code,
an independent award assessment, or a guarantee of virality or store approval.
Papzi remains a targeted-QA marketplace, not a production-proven equivalent of
Uber, Airbnb, Instagram, OnlyFans, Snapchat or Threads. See
[current release status](RELEASE_STATUS.md) for deployment and financial gates.

## What To Learn From The Market

The mechanisms below are documented by their operators. Their contribution to
Papzi's growth is a hypothesis to test, not proof of why an entire company went viral.

| Product | Documented Mechanism | Papzi Application | Missing Evidence |
|---|---|---|---|
| Uber | Its described refer-a-friend offer qualifies rewards after a new rider completes a trip, not after sharing a link. [Uber Help](https://help.uber.com/en/riders/article/refer-a-friend-program?nodeId=4d918571-17ab-4d8f-8967-2be24bea8800). | Reward a genuine first paid, completed shoot only after settlement, with a funded budget and anti-abuse rules. | Complete financial lifecycle, attribution, referral eligibility and fraud handling. No cash-referral promise is added now. |
| Airbnb | Services include photography; providers are assessed for expertise and reputation. [Airbnb Services](https://www.airbnb.com/resources/hosting-homes/a/introducing-airbnb-services-741). | Compete on local photography specialization: credible portfolios, published packages, availability, clear deliverables and transaction-backed reviews. | Real paid-shoot completion, customer support outcomes and dependable creator settlement. Photography alone is not a unique category. |
| Instagram | Explore uses candidate retrieval, staged ranking, interaction signals, quality filtering and diversity. [Meta Engineering](https://engineering.fb.com/2023/08/09/ml-applications/scaling-instagram-explore-recommendations-system/). | Initially rank eligible local creators and approved work using location, genre, availability and explicit interactions; evaluate suitability and booking conversion before training complex models. | Recommendation quality, cold-start relevance, negative feedback and repeat-use measurements. A recommendation container is not product acceptance. |
| OnlyFans | In its historical response to Ofcom, the operator describes creator-specific subscriptions and audiences finding creators on other platforms. [OnlyFans submission](https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/240428-first-phase-of-online-safety-regulation/responses/onlyfans?v=201857). | Let creators bring existing audiences to a reliable professional profile and booking journey. Separate physical shoots from digital subscriptions. | Public share/install fallback, attribution, financial acceptance and store-compliant digital billing. The submission is the operator's account, not independent assurance of current safety or architecture. |
| Snapchat | Its July 2026 Spotlight update prioritizes original human-made creativity and transparency around AI editing. [Snap Newsroom](https://newsroom.snap.com/rewarding-authentic-creativity-on-spotlight?lang=en-GB). | Real, consented work and useful behind-the-scenes content can establish credibility. Do not fabricate portfolios or engagement. | Media delivery on slower networks, moderation response, content rights and sustained creation/retention. |
| Threads | Launch integrated Instagram identity and the ability to follow existing accounts. [Meta launch announcement](https://about.fb.com/news/2023/07/introducing-threads-new-app-text-sharing/). | Reduce onboarding friction and use opt-in creator sharing and agency/community partnerships. | Papzi has no comparable installed social graph. OAuth and consented invitation delivery must work before promising one-click acquisition. |

Apple requires functioning submitted features, reporting/blocking and moderation
for user-generated content, and appropriate purchase handling. A private paywall
does not make prohibited sexual services or pornography acceptable. Do not market
Papzi as an adult-services loophole. [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

## Shortfalls Identified

These are **12 explicit work items**, not a claim that only 12 defects exist.
Earlier browser evidence covered 22 of 44 screen entry points, not all controls.

| Priority | Shortfall | This Pass / Acceptance Still Needed |
|---|---|---|
| P0 | No accepted real payment -> completed shoot -> refund/settlement journey. | Keep checkout disabled; reconcile signed callback, replay, cancellation, refund and independently observed creator bank settlement before public launch. |
| P0 | Phone builds, source revisions and backend capabilities are not jointly accepted. | Push exact source; deploy immutable tested API images; only build a new native candidate after release gates pass. Old TestFlight builds do not receive this source automatically. |
| P0 | Admin owner allowlist did not reliably enable mobile admin navigation. | Server-derived `is_admin` capability across auth/session/current-user mapping; reject profile/metadata/cached privilege escalation. Native acceptance still required. |
| P1 | Creator profile fabricated 128 reviews, defaulted to 5.0 and claimed an unsaved collaboration request. | Remove these claims and fake completion controls. Use approved, paid, completed-booking-backed reputation aggregates. |
| P1 | Uncached creator/model profiles depended on the limited discovery cache. | Fetch authoritative profile and correct talent record; separate loading, missing and network-failure states with retry. |
| P1 | Follow lookup treated a missing optional row as failure; UI could hide failed actions. | Optional-row lookup, explicit failures and pending-write guard; update state after acknowledgement only. Cross-device follow atomicity remains a separate acceptance item. |
| P1 | Profile sharing had the wrong app route and no measurable acknowledgement. | Registered `papzi://user/<id>` route and confirmed-share event. It is an installed-app link, not a universal link or completed invitation. |
| P1 | Profile reporting relied on a native alert that is unreliable on web. | Cross-platform reason/confirmation form, preserved failed input and server-confirmed result. Timely staff handling still requires operational proof. |
| P1 | Media refresh failures and reputation reads could look like empty content or perfect ratings. | Storage reference resolution, cached recent-work fallback, review-load errors/retry and no five-star default. Full native media quality remains unaccepted. |
| P1 | Booking/chat write p95 was about 5.04 seconds in the latest baseline CI workload. | Measure query, lock, connection and outbox traces; target <2 seconds without weakening conflict or financial controls. This is a Papzi target, not an Uber benchmark. |
| P1 | Growth analytics can lose failed batches; there is no verified acquisition-to-settlement funnel. | A share event is instrumentation only. Complete bounded retry/idempotency, consent, actor isolation, attribution and acceptance against stored events before relying on conversion reports. |
| P1 | Full native usability, dispatch, live video, physical-device push and operating response remain incomplete. | Enabled-screen action matrix, four-role device tests, interrupted networks, monitoring, scheduled backups, restore drills and incident ownership. No best-app or complete-44-screen claim. |

## Executed Before And After

| Before | Implemented Change | Verification Boundary |
|---|---|---|
| Fixed marketing counters and a fake collaboration result. | Actual identity/location/work/rate; real summary; request-shoot navigation instead of fabricated success. | Focused component/service tests plus isolated PostgreSQL summary filtering. Real paid shoots remain unverified. |
| A model outside the discovery cache could be unavailable or treated as a photographer. | Role-aware authoritative profile fetch and modeling booking payload. | Cold-cache and failure/retry tests; not a physical-device booking acceptance. |
| Profile subscription/tip/collaboration actions implied unsupported completion. | Profile focuses on verified scheduled shoots, chat, follow and portfolio; unavailable digital promises removed from this surface. | Existing digital code is retained as gated/backlog work, not newly accepted monetization. |
| UI admin detection relied on business role. | Independent server allowlist capability; business role stays client/model/photographer. | Privilege-forgery, restoration and UI-gate tests; server remains final authorizer. |
| Recent work/reporting lacked reliable cross-platform recovery. | Explicit error/retry and acknowledged moderation report. | Targeted interaction/browser tests do not prove moderation staffing or every device. |

## Execution Order

1. **Trustworthy candidate:** run source checks and focused regressions; execute real
   PostgreSQL review filtering and role protocols in isolated CI; push GitHub and
   promote only exact images after backup/restore rehearsal. Preserve production data.
2. **Financial acceptance:** validate current merchant configuration without exposing
   secrets; perform controlled payment/callback/refund/settlement checks and reconcile
   ledger/provider records. Obtain gateway and banking operational requirements;
   application records alone do not prove escrow or money movement.
3. **Native acceptance:** test client, photographer, model and admin on actual iOS
   and Android candidates; include every enabled control, accessibility, small/large
   screens, permissions, background/reconnect and media. Store groups receive only
   an accepted candidate. Complete refund/deletion/moderation and unavailable services.
4. **Performance/operations:** repeat the same 300-session workload; trace slow writes,
   queue lag and connection churn. Define alerts, backup retention, incident contacts,
   financial reconciliation and rollback drills. Keep real financial secrets out of QA.
5. **Measured local launch:** start one South African city/genre cohort with consented
   portfolios and creators who can fulfil shoots. Decide the city from actual supply
   and buyer demand, not placeholder coordinates. Verify reviews, complaints and
   payouts before expanding to additional cities.
6. **Growth loop:** useful portfolio -> confirmed share -> qualified profile visit ->
   quote -> paid shoot -> deliverables -> approved review -> repeat booking. Measure
   each transition. Add HTTPS universal/app links with a working install/web fallback,
   then creator cross-posting and opt-in partnerships. Reward settled outcomes only
   after the unit economics and anti-fraud controls are accepted.
7. **Africa/world:** expand only where support, payments, local policy, currency,
   localization and sufficient creator supply are accepted. Existing South African
   onboarding is not evidence of readiness in every country.

## Success Measures

North star: completed paid shoots with independently confirmed creator settlement.
Supporting measures: time to suitable available creator; quote/request conversion;
acceptance/cancellation; delivery timeliness; repeat paid bookings; complaints and
refund resolution; creator earnings after platform/payment costs; media latency;
crash-free sessions; request/queue latency and backup restore success.

Define baselines before setting growth promises. Provisional engineering targets
are booking/chat write p95 <2 seconds under the recorded workload, zero duplicate
financial effects, and >=99.5% crash-free sessions in an accepted native beta cohort.
These are project targets, not achieved measurements or competitor statistics.
Do not trade privacy, truthful claims, moderation or financial correctness for reach.

## Release Evidence

Source candidate `403cd0e` is pushed to `release/testflight-2026-06`. Exact-candidate
CI passed 323 API tests, 25 worker tests (no skips), and frontend/deployment checks.
The frontend has 300 passing tests and six targeted synthetic-transport browser
checks. Isolated CI completed 300 concurrent read sessions and 200 booking/chat
journeys without errors; write p95 remains 5.16 seconds, above the project target.

Oracle API/worker were promoted by immutable digest at `2026-10-04T09:54:13Z`
after restoring and checking a protected production backup. Public review summaries,
missing-profile handling, road geometry and access rejection passed subsequent
read-only probes. Data and integration configuration were preserved. This is a
backend deployment, not a new installed phone version. Public readiness remains
false; no new store build, tester invitation or public submission was made.

Implementation and verification evidence for this pass is recorded in
[competitive release evidence](competitive-release-20261004.json).
An updated GitHub repository and deployed API do not constitute TestFlight/Play
distribution or public approval. The release gate remains the authority for that
decision; do not relax it to satisfy a marketing date.
