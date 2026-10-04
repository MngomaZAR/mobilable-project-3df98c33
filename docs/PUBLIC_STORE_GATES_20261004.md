# Public Store Gates

Observed October 4, 2026 in the signed-in account and public endpoints. Existing
credential access resolves upload permissions, not functional acceptance or
store eligibility. iOS 41 / Android code 4 are testing releases only.

## Google Play

- Correct package: `com.papziiii.paparazzi`, personal developer account.
- Internal code 4: active/completed; existing lists `Testerrrs` and `Testers` have
  three entries each, possibly overlapping. These are not six closed-test opt-ins.
- App setup: 0 of 11 tasks complete. Privacy policy, app access, ads, content
  rating, target audience, Data safety, government/financial/health declarations,
  category/contact details and store listing remain to be accurately completed.
- Closed-test setup is gated by app setup. Production requires a closed release,
  at least 12 real testers continuously opted in for 14 days, then a production
  access application explaining test feedback and changes. Current opt-ins: 0.
- The clock cannot be backdated; internal installs/invites do not start it.
  The owner has been asked which existing group contains 12 willing testers.
- Public production remains empty; no public publishing was attempted.

Primary instructions: [Personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).

## Privacy, Terms And Deletion

`https://papzii.co.za/privacy` and `/terms` currently return 404. The existing
cPanel account is accessible; its `public_html` was observed empty. No website,
DNS, database, customer mailbox or file was overwritten. Do not install a new CMS
or copy an old policy simply to obtain HTTP 200.

The March `src/constants/LegalContent.ts` and `LegalScreen.tsx` are not accepted
legal/compliance evidence. Resolve these discrepancies before public submission:

| Existing statement | Verified discrepancy / required action |
| --- | --- |
| Papzii (Pty) Ltd is incorporated and the responsible party. | No registration/operator identity was verified. Owner confirmation is outstanding; SAICTS is documented as the contracted builder, not automatically the operator. |
| 30% commissions, VAT-inclusive prices and five-day payouts. | Server quote rate is configurable (default 20%); VAT status and settlement timetable are unverified, and public bank payouts are paused. Use owner-approved terms and actual quote disclosures. |
| Fixed cancellation percentages and automatic model-release acceptance. | Server cancellation records a refund incident; no accepted refund execution or these exact percentages is established. Contracts need explicit participant consent, not inferred booking consent. |
| GPS only during accepted bookings, never retained afterwards. | Discovery/routing and private online-provider fixes also use location. Booking sharing is paid/participant/time-window controlled, but row freshness is not deletion; stored fixes and backup retention require explicit policy/enforcement. |
| POPIA compliant, regular audits and all documents legally binding. | Engineering tests are not a legal review, compliance certification or proof of recurring audits. Remove unsupported assurances and obtain operator review. |
| Age-gated adult-content areas and named contact mailboxes. | Public content rules must align with store restrictions and actual moderation. Only tested contact routes may be promised; consent/18+ checks do not permit prohibited content. |
| Cookie/analytics opt-out in settings. | Declare actual SDK/device-storage behavior and verify the promised settings; do not invent consent controls. |

The owner has been asked for the actual legal operator/responsible party. Prepare
accurate policy/terms, retention categories and deletion instructions, review them,
then publish static HTML at the existing domain without changing Oracle hosting.
Align native legal copy, onboarding consent and store metadata with the same
approved version; installed build 41 cannot gain edited text without a new binary.

Account creation requires both an in-app deletion path and an accessible external
deletion request resource. The server queues guarded account cleanup and retains
necessary financial/history tombstones, subject to unresolved booking/balance/legal
holds. Production erasure, hold resolution, backup expiry and response handling
still need acceptance; do not promise immediate total erasure. The external
resource must identify Papzi and a monitored request method without demanding
passwords or identity documents in ordinary email.

Primary instructions: [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en),
[Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).

Public `validate:env:release` now rejects unreachable/non-HTML/empty legal pages
and off-document redirects; six focused regression tests passed. This availability
test does not approve policy content. The live public check fails on both 404s and
the five backend capabilities; restricted internal validation passes separately.

## Web Workflow Repair

The manual GitHub web workflow previously validated in an `env:exec` child, then
exported by sourcing `.env.eas.production`, which no step created. It also omitted
optional compiler dependencies. It now uses the existing EAS production variables
for `npm run check:release` (validation, tests/audits and export in one child),
retains locked compiler dependencies and pins EAS CLI 24.10.0. Deployment is still
manual and follows successful validation; it selects the same production EAS
environment. Three regression checks cover ordering, scope, permissions and
dependency installation. This workflow correction is not a public deployment;
current readiness deliberately prevents it from publishing an incomplete app.

Primary instructions: [EAS environment usage](https://docs.expo.dev/eas/environment-variables/usage/).

## Functional And Apple Gates

1. Real checkout/refund/creator settlement with authorized provider accounts and
   independent readback; missing payout credentials cannot be replaced with a
   checkout merchant key. No acceptance rows may be fabricated.
2. Physical iPhone/Android video, push, dispatch, network/permission interruption
   and all-role/all-control acceptance; record exact build and server revision.
3. Address write latency, storage/dependency/proxy findings, off-host backups,
   rollback and incident/monitoring acceptance.
4. Approved privacy/terms/deletion and store declarations, native screenshots,
   content/moderation procedures and working least-privilege reviewer access.
5. Only then submit public Apple App Review and the eligible Play production
   application/release. Apple beta approval is not public App Review approval.

No public-review approval, marketplace parity or completed device test is claimed.
