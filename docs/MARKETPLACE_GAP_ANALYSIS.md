# Marketplace Gap Assessment

Assessed 2026-10-04. This is an engineering assessment of Papzi's verified
capabilities, not a benchmark of competitors' source code, revenue or performance.
Overall maturity: **2/5, private-QA marketplace with a newly aligned public API**.
This is not a public launch recommendation or a claim of superiority.

## Scoring

0 = absent; 1 = source implementation; 2 = targeted QA acceptance;
3 = independent live domain acceptance; 4 = native beta acceptance;
5 = sustained public operation with measured service levels.
Safety and financial blockers override an average score.

| Area | Papzi Score | Evidence and Gap | Next Acceptance |
|---|---:|---|---|
| Discovery and portfolios | 2/5 | Photographer/model surfaces and storage protocols exist. Search relevance, cold start, media quality and recommendation outcomes are not measured in production. A running Typesense container is not integrated search. | Seed real, consented portfolios; test location/category/rate filters and signed media on devices; measure time to a suitable creator. |
| Booking experience | 2/5 | Server pricing, conflicts, provider acceptance and four-role QA exist. Booking details now distinguish acceptance from payment. No complete real paid shoot is accepted. | Client request -> creator accepts -> verified payment -> arrival -> completion -> settlement -> exact-booking review. Include cancellation and dispute branches. |
| Maps and dispatch | 2/5 | Public Oracle road routing returns 122 coordinates, not a straight-line fallback. Native map framing, GPS permission denial, rerouting and instant dispatch remain unaccepted. | iPhone/Android road geometry, ETA changes, unavailable routes, background behavior and concurrency-safe offer acceptance. |
| Trust and support | 2/5 | KYC upload/review and moderation have targeted QA. Support retains booking references; duplicate action guards and error states are added. Staff coverage, escalation and real deletion operations are unverified. | Auditable decisions, privacy checks, support response ownership, blocked-user tests and production admin access. |
| Creator monetization | 1/5 | Payment/refund/payout protocols have mocked-provider evidence, not verified money movement. Store digital purchases remain disabled. | Live merchant credentials, signed callbacks, duplicate reconciliation, refund execution and independently verified bank settlement. |
| UI and accessibility | 2/5 | Targeted booking/KYC/support improvements and phone/desktop browser checks. Earlier inventory evidence covers 22/44 entry points, not all buttons or native devices. | Every enabled screen/action, large text, keyboard/screen reader, dark/light themes and small/large devices. |
| Reliability and operations | 2/5 | Immutable API/worker cutover, backup restore, migrations and public core probes accepted. Recovery email reached the owner inbox; this is not recovery acceptance for every user. Push/video, backup retention and incident ownership are unfinished. Baseline CI write p95 ~5.04 seconds remains too slow. | Target p95 <2 seconds for booking/chat writes under the defined 300-session workload; alerts, scheduled backups, restore drills and on-call response. This is a project target, not a competitor benchmark. |

## Relevant Market Standards

- Uber makes pricing and reservation state explicit. A reservation is not a
  guarantee of an assigned driver, and arrival times are estimates. Papzi should
  distinguish request, provider acceptance, payment and arrival just as clearly.
  [Uber Reserve terms](https://www.uber.com/global/en/legal/uber-reserve-terms-of-use/),
  [Uber API best practices](https://developer.uber.com/docs/riders/ride-requests/tutorials/api/best-practices).
- Airbnb separates identity checks, private documents, cancellation policy and
  refund amounts. Papzi needs equivalent clarity, not copied refund guarantees.
  [Identity verification](https://www.airbnb.com/help/article/3033),
  [Cancellation and refund information](https://www.airbnb.com/help/article/169).
- OnlyFans is relevant as a creator-monetization category, not a template for
  Papzi's store content policy. Its official terms were not accessible during this
  audit; no internal architecture or feature-parity claim is made. Regulatory
  scrutiny shows that age checks require evidence, not marketing assurances.
  [Ofcom's OnlyFans investigation](https://www.ofcom.org.uk/online-safety/protecting-children/cw_01283).
- Apple requires working submitted features, suitable user-generated-content
  safeguards and appropriate payment handling. Pornographic content is not made
  acceptable by putting it behind a private or paid screen.
  [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

## Before and After This Change

| Before | After | Still Not Proven |
|---|---|---|
| Old public API: readiness/routing 404. | Existing Oracle service promoted to immutable tested images; public contract and road routing pass. | Native binaries use and correctly render every new domain feature. |
| Acceptance and payment conflated in detail actions. | Separate progress states; unpaid bookings cannot navigate tracking. | A live paid shoot and settlement. |
| Provider chat could target the provider; missing cached profile redirected silently. | Chat derives the other party from booking IDs; failures are explicit. | All chat/video/media behaviors under real device interruptions. |
| Support had no booking context; web alerts could hide results. | Persisted ticket reference, booking context, inline success/error and duplicate guards. | Staff resolves tickets against operational service levels. |
| KYC could submit while an upload was unfinished. | Serialized uploads, authoritative completion gating, read retry, retained documents and confirmed submission state. | Real identity assurance, document retention/deletion and production admin acceptance. |
| A placeholder test asserted only true. | Placeholder removed; focused workflow regressions added. | Complete 44-screen native action coverage. |
| Shared booking projection discarded scheduled times; older links depended on an 80-item cache. | Shared mapper retains start/end, screens display shoot time in SAST, and uncached detail links fetch an owner-scoped record with retry. | Native cold-start/deep-link and interruption acceptance. |

## Launch Order

The six-product comparison, additional source gaps and execution plan are in
[Competitive Execution](COMPETITIVE_EXECUTION_20261004.md). Improvements to one
profile surface do not raise the whole app to sustained-production maturity.

1. Existing merchant and restricted SMTP credentials are configured on Oracle;
   checkout remains disabled and admin capability requires candidate acceptance.
   Execute real payment/refund/settlement and complete recovery checks without
   moving secrets into mobile code.
2. Finish operational acceptance for dispatch, push and video. Keep unavailable
   functionality explicitly disabled; do not override readiness flags.
3. Reduce booking/chat write latency using measured query/lock/outbox traces,
   then rerun the same concurrent workload and interruption tests.
4. Complete all enabled native role journeys and the 44-screen action matrix.
5. Build exact iOS/Android candidates with the verified production URL and store
   identities. Obtain external TestFlight approval, add accepted builds to existing
   groups and notify testers, including Jones. Complete Play testing requirements.
6. Submit public metadata/privacy/reviewer access, then launch a monitored,
   geographically bounded photography marketplace. Expand only after successful
   paid shoots, repeat bookings, dispute outcomes and creator settlement are measured.

The competitive advantage is a dependable photography workflow, creator rates,
portfolio discovery and local supply. Adding platforms or copying every social
feature before the paid workflow works would not close these gaps.
