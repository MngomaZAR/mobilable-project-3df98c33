# October 4 QA Follow-Up

Scope: frontend changes in the commit containing this report against the existing
isolated Oracle QA backend revision `db425300`. No production user fixtures were
created and no live payments, emails, push or video media were sent.

## Passed Checks

- TypeScript typecheck and ESLint.
- Jest: 23 suites / 246 tests. Existing VirtualizedList `act` timing warnings remain
  in unrelated Home/Admin test fixtures; no tests were changed to suppress them.
- Deployment helpers: 12 Python regression tests.
- Store/release helpers: 8 Node regression tests.
- Source/import/runtime/architecture audits; architecture inventories 44 screens
  and reports zero static blockers. Dashboard 18/18; single-flow 6/6.
- Schema audit: 47 referenced tables, 48 exposed live tables, zero findings.
- Private QA web export, SDK 54, ~5.93 MB main JavaScript bundle. This loopback
  export is a test artifact and **must not be published**.
- Four Playwright workflows passed in 44.2 seconds with enabled synthetic QA writes:
  model service rates/availability; client scheduled booking and photographer
  acceptance/chat/support/cancellation; KYC upload and admin identity/document
  decisions; moderation approval/rejection with outsider visibility checks.

Booking detail was inspected at 390x844 and 1440x900. Both widths passed horizontal
overflow checks. Actual shoot time now appears as 16:00 SAST, rather than midnight;
start/end times survive the shared query/mapper. Unpaid tracking stays disabled.
Tests use actual screens and API persistence, not a synthetic UI mock.

## Failures Investigated

1. A chat test expected a new creation POST even when a valid existing conversation
   was reused. It now verifies navigation and the two real persisted participants.
2. KYC submission could race its last upload. Uploads/submission are serialized,
   loading/error/empty/content are distinct, and retry retains document state.
3. Support's accessible button name included an icon glyph, preventing an exact
   selector. It now has a stable label plus visible success/error and duplicate guards.
4. An earlier failed test left an accepted synthetic booking in the shared time
   slot. A later attempt correctly received 409. Only that authenticated QA client's
   identified, unpaid synthetic record was cancelled; no production data was changed.
5. Repeated fixture logins exceeded 10 attempts/10 minutes and correctly received
   429. The rate window expired normally; no limiter was disabled or reset.
6. Inspection found booking start/end times missing from the query and mapper.
   All booking-list/detail/provider surfaces now share the South African shoot-time
   formatter, with date-only legacy records not presented as midnight appointments.

The final rerun passed with these fixes. Uncached detail links also have focused
unit tests for owner-scoped loading and retry, rather than requiring the latest
80 list records to contain the booking. Browser cancellation now requires a real
confirmation and confirmed server transition; it does not promise a refund.

## Public and Store Evidence

At 02:29 UTC the public Oracle health/version/schema/road-routing checks passed.
The public API is on immutable tested API/worker images and all 12 migrations;
existing production identities, credentials, sessions and records were preserved.
The first guarded cutover reverted before reopening traffic due to a revision
checker bug, which was repaired and regression-tested before successful cutover.
See [Oracle Release Runbook](ORACLE_RELEASE_RUNBOOK.md) for backup receipts.

`npm run validate:env:release` **fails deliberately and correctly** on seven live
capability blockers: checkout, admin configuration, refunds, bank payouts, recovery
email, video and instant dispatch. Available source/mocked tests do not override
independent production acceptance.

Jones is already in external TestFlight group `papzi`, which has no builds. Build
38 is valid in internal `Team (Expo)` testing, not an approved new external
candidate. No invitation delivery or public submission is claimed. Android's
verified listing remains an empty internal draft. No native build was started.

This report does not certify all 44 screens/actions, physical devices, native GPS,
video/push delivery, money movement, sustained performance or competitor parity.
The remaining plan is in [Marketplace Gaps](MARKETPLACE_GAP_ANALYSIS.md).
