# Mobile delivery record

Candidate: `ae6657699771fa7ff025c7b329026c6859d6ae37`.
Backend code parent: `5e3dfc384fb3f38edc2566e9129a342af011267d`, verified live.
The candidate changes only upload exclusions and release records; application
code matches the deployed backend source revision.

On 13 October EAS accepted these restricted beta builds and scheduled uploads:

| Platform | Build | Version | Upload submission | Scope |
| --- | --- | --- | --- | --- |
| Android | 0d1e6ff9-caa5-4b2d-ae9b-9cb2a70d618e | 5 | 37d320e4-4185-4fca-9442-134092375801 | Play internal, draft |
| iOS | bbd7496e-0aef-4924-b891-7b21ffcf06ec | 42 | 8b7c2efc-abaf-4da7-bb2e-822f7abacb12 | App Store Connect / TestFlight |

At scheduling time both submissions were `AWAITING_BUILD`. This record does not
claim upload success, TestFlight external review, public store submission or
approval. Purchasing is disabled in the restricted testing configuration.

Source verification: 38 frontend suites / 382 tests, TypeScript checking,
10 release-gate/artifact tests passed. The isolated Oracle QA upgrade, legacy
notification migration and workflow/payment protocols passed; gateway responses
in the protocol test were mocked. No money was moved.

The signed live PayFast ping returned HTTP 200 and the public string
`PayFast API`. The first probe wrongly assumed refund-style object responses,
then compared capitalization strictly. This was a probe-format issue, not proof
of invalid merchant credentials. A ping is not payment/refund/payout acceptance.
Reference: https://developers.payfast.co.za/api#ping-response

Outstanding external inputs: signed-in branded hosting access, confirmed creator
payout arrangement and independent native-device/live financial acceptance.

## Browser and QA follow-up

The first complete browser run recorded 32 passes, two payout-screen expectation
failures, one obsolete Supabase fixture failure and four opt-in workflow skips.
The payout assertions now explicitly verify the restricted-build unavailable
screen and its no-money warning. The old Supabase fixture is restricted to
explicit local-only use and is not current-release evidence. Its attempted
hosted reference-account preparation is not Oracle production testing.

All eight targeted settings/workflow tests then passed with explicit isolated-QA
write opt-in: four roles' settings, persisted model rates/availability,
server-priced booking request/acceptance, KYC upload/admin decisions and content
moderation/outsider visibility. Combined with unchanged passing cases, 38 current
browser cases have passing evidence. No claim of real money or native acceptance
is made. The legacy fixture guard regression test also passed.

iOS build 42 finished in EAS. The subsequent Apple query still showed build 41
as its latest received build, so successful upload of 42 was not yet confirmed.

## Apple beta submission confirmed

At 13:10 UTC Apple confirmed build 42 `VALID` and unexpired. It is assigned to
both existing beta groups and available internally. The hosted reviewer sign-in
check passed before the external beta review request. Apple returned
`WAITING_FOR_REVIEW`; `publicAppReviewSubmitted` is false. Exact receipts are
`testflight-build-42-prepare-20261013.json` and
`testflight-build-42-beta-review-20261013.json`. This closes upload and external
beta submission, not native acceptance or public App Store review.

Android version 5 was still building at the last check; its internal/draft upload
submission remains scheduled. No Android upload success is claimed yet.
