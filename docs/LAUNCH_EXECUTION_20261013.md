# Papzii launch execution record

Observed 13 October 2026. This is a gate record, not store approval or a claim
that a source-code test represents an installed iOS or Android build.

## This change set

- Map discovery now excludes unapproved or synthetic profiles, matching Home's
  eligibility rule. A known account city determines the initial map center when
  GPS is unavailable and orders talent by actual distance from that city. The
  search label says what it actually searches; distant results are not called
  nearby. Dragging starts from the sheet handle, leaving the list free to scroll.
- Empty Bookings has a route back to creator discovery.
- Backend and deployment *defaults* now specify a 30% booking commission, and
  readiness fails if the effective backend setting differs. Existing production
  environment variables are not changed by this commit. Server quotes remain
  authoritative; mobile calculations are display-only fallbacks.
- Synthetic reference seeding is restricted to an explicitly selected local
  Supabase instance. It must never be used as public marketplace inventory or
  proof of settled bookings.
- Settings and Feed headings now fit mobile screens; Feed shows an honest empty
  state and only offers creator posting to creator accounts. The map panel fits
  its collapsed text, the locate control follows the panel, and photo failures
  fall back to a local icon. Foreground chat and booking screens refresh API
  data while focused because the API channel is not a real-time transport.
- The API now restricts browser CORS to explicit configured web origins. Expo's
  generated iOS config no longer declares Always location, and Android blocks
  legacy external storage, overlay, and background-location permissions.
  Android Auto theme now has the SDK-matched `expo-system-ui` native module.
- Scheduled booking now requires `verified=true`, approved KYC and age
  verification together, matching payout eligibility. A legacy verified flag
  cannot bypass identity review. The admin queue now provides five-minute,
  owner-matched private KYC document links and disables approval when no
  reviewable link is available.

## Nine public-launch gates

| Gate | State | Acceptance evidence still required |
| --- | --- | --- |
| 1. Working product | Open | Rebuild and test exact iOS/Android binaries on physical phones. Verify safe areas, map sheet, search, buttons, permissions, and all roles. Source tests alone do not close this. |
| 2. Real creator supply | Open | Consent and onboard verified photographers/models with real rights-cleared portfolios, service areas, rates, availability and approval records. No synthetic public profiles. |
| 3. End-to-end bookings | Open | Record independent client/creator readback for request, acceptance, chat, payment, completion, cancellation and dispute; include latency and reconnect cases. |
| 4. Money movement | Blocked | Authorized live merchant and payout-provider accounts; 30/70 fee schedule and fee bearer approved; live checkout, callback, ledger, refund, chargeback and bank settlement evidence. Readiness currently fails checkout, refunds and payouts. |
| 5. Advertised services | Blocked | Video and instant dispatch need accepted real-device/service evidence or must be removed from public scope and claims. Both currently fail readiness. |
| 6. Safety and privacy | Open | Moderation staffing and response SLA, reporting/blocking, age/identity procedures, account recovery/deletion, retention, security review, off-host backup/restore and incident drill. |
| 7. Business and legal | Blocked | Confirm operator identity, tax/VAT status, creator contracts, fee/refund/payout terms, POPIA review and published approved policies. `/privacy` and `/terms` returned 404 on 13 October. Current bundled legal text contains claims not yet verified. |
| 8. Store submission | Blocked | Complete Apple and Play declarations/listings, screenshots and reviewer accounts; physical-device QA; required Google closed-test eligibility; submit only a revision that passes all gates. TestFlight and internal Play are not public approvals. |
| 9. Payment-policy classification | Open | Classify each SKU. In-person photo/model bookings may use an eligible external processor; digital unlocks, subscriptions, boosts and in-app content require separate Apple/Google policy review and billing implementation or must stay disabled. |

## Booking economics decision

At a ZAR 1,000 customer price, a 30% platform fee and 70% creator share mean
ZAR 300 and ZAR 700. The operator confirmed that Papzii's 30% covers payment
processing and other platform costs; the creator's 70% is not reduced by those
fees. The operator also states that Papzii is not currently VAT-registered, so
the platform must not show a VAT charge. Refunds and chargebacks still need an
approved, precise allocation policy. The
server must quote, persist and reconcile the same breakdown. Pending ledger
rows are not money transferred.

The bundled legal text still contains unreviewed operator, VAT and payout
claims. The VAT line in the booking UI is removed, but legal copy must be
approved and reconciled before publication; a source edit is not legal sign-off.

## Live recheck (13 October 2026)

Production reports revision `200d60599c92c800ab29bba6eb8b4a4a1b7cfdf6`,
which does not contain this change set. Its readiness is false: checkout,
refund execution, bank payout execution, video call service and instant
dispatch service all report unavailable. Both `https://papzii.co.za/privacy`
and `https://papzii.co.za/terms` return HTTP 404. The replacement
`api.papzii.co.za` hostname did not resolve in this check; keep the existing
working API URL until DNS, TLS and a verified deployment are in place.

`npm audit --omit=dev` reports 45 production-tree advisories (26 high,
19 moderate) after installing SDK-matched `expo-system-ui`. Several originate
in Expo/React Native build dependencies and suggest major-version upgrades;
triage each reachable runtime exposure before release rather than applying a
blind dependency upgrade.

## Same-day candidate check

The owner confirmed two existing TestFlight participants as intended real pilot
creators. TestFlight membership is not creator onboarding or approval; neither
account was promoted by this source change. Each must complete creator signup,
consent, age declaration, identity/selfie review, profile, rights-cleared media,
rates, service area, availability and payout verification in the live system.

On 13 October, `npm run check:launch` passed 37 frontend suites / 376 tests,
source/runtime/architecture audits and web export. After the KYC queue change,
38 provider-pricing tests, one admin KYC queue test, 18 admin UI tests, typecheck
and lint passed. `npm run validate:env:release` still fails as intended on five
unavailable live capabilities and the two HTTP 404 legal URLs. A broad web
Playwright run was stopped after the auth smoke passed and Oracle-dependent
chat/map cases failed; this is not an end-to-end pass or native-device evidence.

Next promotion sequence: push one exact source revision, require backend image
CI and digests, rehearse Oracle backup/migrations, promote the same API/worker
revision with the guarded helper, verify public revision/schema and private
media access, then build that revision for TestFlight and Play internal testing.
Do not activate payments or submit public store releases until merchant refund
and payout evidence, reviewed public policies, and physical-device journeys pass.

## Verified candidate and operator evidence

Candidate `4de12cf6e59bea1b1542a1c50c60331ae7ca8f3e` passed frontend CI
and backend run `38385315425`, including the PostgreSQL protocol job and
both API and worker image builds. The payment protocol now expects ZAR 980
in pending creator earnings on the ZAR 1,400 fixture, matching the 30/70 split.
The live `/version` endpoint still reports `200d60599c92c800ab29bba6eb8b4a4a1b7cfdf6`.
This candidate has not been promoted or submitted to the stores.

The owner confirmed SAICTS is not Papzii's legal operator. The local certificate
`C:/Users/27790/Downloads/CoR15_1_A_9430620677.pdf` identifies
PAPZ (Pty) Ltd, registration 2025/188861/07. The owner confirmed that PAPZ
operates the Papzii product and receives the platform commission. Bundled
company identity is corrected accordingly; public policy publication and
the remaining policy review are still outstanding.

## Live promotion and user-flow follow-up

Production SSH access was recovered using the existing authorized key, matched
against the owner's Cloud Shell public key. The target is exclusively
`papzi-prod-a1` / `129.151.188.15`; the older `papzi` micro instance at
`84.12.74.134` has no backend installation. Madabukela remains a separate project.

Candidate `0fb2e585b803718df0acf21b8f5beda1dc5e6ced` passed CI and matching backend
image builds and was promoted through backup restoration and guarded cutover.
The public revision/schema/routing/anonymous-access checks passed. A subsequent
guarded configuration applied explicit `COMMISSION_RATE=0.30` in API and worker,
preserving images and database. Private configuration receipt:
`/var/backups/papzii/configuration-20261013T114409Z/configuration.json`.

The initial wrapper's follow-up configuration call used the wrong request
envelope; its backend promotion had succeeded, but the configuration call was
rejected. The correct `updates` envelope was then applied successfully. The
wrapper and its regression check are corrected. The staging step also now uses
sudo to create only its owned private directory on this host's restricted `/tmp`.

Ten browser chat/map checks passed on phone and desktop viewports after clearing
a stale local bundle that still targeted production. The rebuilt private client
targets the isolated QA API through SSH. An upgraded QA protocol run exposed old
notification records without navigation metadata; a targeted migration is now
covered by real isolated PostgreSQL tests. Its notification bodies and read states
are preserved. Current-source creator enrolment was also tested against isolated
PostgreSQL, including concurrent retries and consent-failure rollback.

Both requested pilot accounts currently have client roles. A new consent-based
client-to-creator application flow is prepared; it never approves identity or
lists the creator automatically. The users must choose their role and complete
their own identity/profile/service/payout onboarding.

Public policy pages are generated from the bundled documents and their mobile
layout was inspected. They have not yet been uploaded to the branded website.
PayFast checkout credentials are configured; no PayFast split-payment integration
or creator split-account configuration was found. Completion-based bank payouts
currently use the unconfigured Stitch adapter. Do not imply automatic 70% bank
settlement from a pending earnings row or a mocked protocol check.

The Apple API confirms `com.papzi.app` is in `PREPARE_FOR_SUBMISSION`; build 41 is
the latest valid uploaded build. Public paid-service/native-device acceptance
and new mobile distribution remain open.

## Public Release Rule

Do not publish, switch on live payments or represent Papzii as publicly ready
until all nine gates have named evidence and the live backend verifier passes
against the exact deployed commit. The current public API fails readiness. No
credentials or synthetic acceptance rows may be substituted for real provider
and device evidence.

## Latest verified deployment

Revision `5e3dfc384fb3f38edc2566e9129a342af011267d` was promoted successfully
on 13 October using the corrected wrapper, backup/restore rehearsal and immutable
API/worker digests. The public `/version` reports that exact revision and
`/health` reports `ok`. API and worker commission configuration is explicitly 30%.
This deploy includes consent-based creator enrolment and the legacy notification
destination migration. Deployment regression tests passed (3/3).

Public `/health/readiness` still reports five blockers: checkout activation,
refund execution, bank payout execution, video acceptance and instant dispatch
acceptance. These are not resolved by deployment. Updated native builds have
not been submitted for public review. The current store uploads remain older
versions. The actionable team checklist is `RELEASE_CHECKLIST_20261013.md`.

EAS upload exclusions now explicitly omit environment files, private key formats,
credentials.json and internal documentation. Do not deploy the local QA web
export: it targets the private localhost API tunnel.
