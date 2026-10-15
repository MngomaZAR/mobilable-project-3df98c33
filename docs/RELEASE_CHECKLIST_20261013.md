# Papzii release and deployment checklist

Last reviewed: 13 October 2026. Operator: PAPZ (Pty) Ltd, 2025/188861/07.
Passing a source test does not mean a native build, payment settlement or store approval passed.

## Current completeness assessment

This is a deployed restricted pilot, not a fully configured public marketplace.
The read-only production audit at 17:31 UTC on 13 October confirmed healthy API,
schema contract and routing, but five unavailable capabilities: checkout,
refund execution, bank payouts, video service and instant dispatch. Source
runtime scanning passed across 147 files. Neither check proves authenticated
live journeys or device usability.

All nine gates below remain open until their acceptance evidence exists.
Latest frontend regression is 39 suites / 385 tests; published web/policy
checks total 24. New iOS 43 and Android 6 candidates are building/queued, not
confirmed distributed. The operator confirmed no payout arrangement exists.
Implementation status, provider configuration, device acceptance and public
store approval must be tracked separately; no aggregate completion claim is
appropriate yet.

| Gate | Responsible role | Current evidence | Required next action |
| --- | --- | --- | --- |
| 1. UI and device experience | Frontend / QA | 382 frontend tests; 10 phone/desktop browser chat and map checks passed | Run the complete browser suite and exact candidate on iOS, Android and tablet; inspect safe areas, keyboard, sheet dragging, scrolling and all controls |
| 2. Real supply | Creator / operations | Two intended pilot users exist as clients; consent-based creator enrolment implemented | Each creator submits their own consent, identity, portfolio, prices, availability and payout details; admin reviews before discovery approval |
| 3. API and workflows | Backend / QA | PostgreSQL enrolment concurrency, rollback and notification migration tests passed | Verify request, acceptance, messaging, reconnect, completion, cancellation, reporting and deletion with independent accounts on the deployed revision |
| 4. Payments | Payments / finance | PayFast checkout credentials exist; server commission configured to 30%, creator 70%; processor costs come from platform share | Confirm merchant capabilities and payout arrangement; reconcile authorized live checkout, callback, refund and creator bank settlement; do not treat ledger entries as transfers |
| 5. Advertised integrations | Integrations / QA | Routing and object storage pass; video and instant dispatch acceptance still unavailable | Test supported integrations end to end or remove them from the initial release scope and claims |
| 6. Production operations | Backend / operations | Oracle API and worker deployed with immutable images; guarded backup restoration and cutover | Verify newest revision, migrations, permissions, alerts, off-host backup restore and rollback drill; retain production data |
| 7. Legal and safety | Operator / security | Operator confirmed; six branded policy URLs published; support inbox present; HTTPS enforced; 19 live policy checks passed | Legal review, paid cancellation/refund/retention terms and operational incident ownership remain required |
| 8. Native delivery and stores | Release / operator | Apple build 42 valid and in external beta testing; Play version 5 completed on internal testing; Jones/Sam handoff SMTP accepted | Verify installed binaries, listing/declarations, reviewer access and test eligibility; public review remains gated |
| 9. Paid-feature classification | Operator / billing | Digital purchases disabled for the current release configuration | Review every SKU against store rules; keep unsupported digital purchases disabled; validate physical-service payment flows |

## Execution order

1. Promote the tested API/worker candidate with a restore rehearsal and verify the public revision.
2. Upgrade the isolated QA environment to the same revision and run full workflow regression.
3. Publish approved policy pages; finish actual merchant/payout configuration without fabricating financial acceptance.
4. Freeze a clean candidate, excluding private environment and signing files from EAS source uploads.
5. Build and distribute matching restricted-test binaries; run independent client/creator/admin phone journeys.
6. Submit publicly only when all launch gates have recorded acceptance evidence. Store approval is a separate external decision.

## Deployment evidence

Production now serves `5e3dfc384fb3f38edc2566e9129a342af011267d`.
The guarded deployment verified promotion and preserved identities; public
`/version` and `/health` were checked afterwards. API and worker commission
configuration is 30%. Public readiness still has five blockers: checkout,
refunds, payouts, video and instant dispatch. Public store submission has not
occurred for this candidate.

## Status language

- Backend deployed: the public API is serving the verified revision.
- Internal distributed: a matching binary is uploaded to the named testing track.
- Submitted: a store review submission exists with an identifier.
- Approved: the store has approved that submission.
- Publicly ready: all nine gates pass, including real settlement and native device evidence.

Do not substitute synthetic profiles, mocked payment responses, old store builds or an empty screen for end-to-end acceptance.
