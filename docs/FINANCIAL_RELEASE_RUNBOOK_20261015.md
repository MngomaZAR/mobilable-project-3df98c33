# Papzii Financial Release Runbook

Last checked: 15 October 2026. Production money movement remains fail-closed.

## Verified production state

The live `/health/readiness` endpoint reports merchant checkout configured,
checkout disabled, and the 30% commission configured. Live refund execution and
creator bank payout execution both report unavailable. The production API is
revision `5e3dfc384fb3f38edc2566e9129a342af011267d`. The financial acceptance
tests pass, but their provider responses are mocked and are not evidence of live
settlement. Do not enable payment collection based on these tests.

The code has server-owned PayFast checkout and refund handling, and a Stitch
disbursement integration. Creator payout configuration is not present in the
current production readiness state. PAPZ previously confirmed it has not yet
arranged a payout provider. Credentials, provider approvals, float funding, and
real settlement proof cannot be inferred from PayFast checkout credentials.

## Money model to reconcile

The server quote is the amount the client pays. The creator allocation is 70%
and PAPZ's gross commission is 30%. PayFast processing fees must be paid from
PAPZ's 30% share; do not reduce the quoted creator 70% to cover them. The
merchant statement's gross, fee, and net values must reconcile to the payment
and commission records. Current production code does not report a verified
statement-level processor-fee reconciliation capability, so finance must
reconcile provider transaction history against every acceptance transaction
and confirm the actual net platform margin before scaling.

For a partial refund, the implementation prorates the creator allocation using
the same 70/30 split. Refund execution is blocked if provider history, payment
identity, merchant/mode, refund balance, or creator paid balance does not match.
The refund POST is one-shot because PayFast does not offer the idempotency
guarantee this workflow would need to safely repeat it; an uncertain response
must be read back and reconciled, never blindly retried. A refund must not be
represented as complete until PayFast history proves it.

Creator payouts use Stitch, not PayFast checkout. The Stitch disbursement
account needs production approval and an adequately funded float account. The
creator's bank details must be entered through the app, independently verified,
and matched to completed eligible bookings. A Stitch `completed` read-back and
bank-side reconciliation are required before the ledger marks a payout paid.
An accepted API request or internal ledger reservation is not a bank transfer.

## Activation sequence

1. **Provider contracting and scope:** PAPZ completes PayFast merchant
   verification and confirms live transaction/refund API access. PAPZ separately
   contracts and completes Stitch Disbursements onboarding, obtains the
   `client_disbursement` scope, creates a signed webhook subscription, and
   funds/maintains the required float. Record approved account identifiers and
   operational owners outside the source repository.
2. **Secret provisioning:** An authorized operator supplies credentials only
   through the protected Oracle/Dokploy secret path. Never paste secrets into
   chat, commit them, add them to EAS public variables, or expose them in logs.
   Keep API and worker environment values aligned. Keep checkout, refund, and
   payout execution flags false while credentials are being checked.
3. **Sandbox protocol checks:** Run the isolated PostgreSQL/provider protocol
   suites for booking quote, callback signature/amount/merchant validation,
   duplicate ITN, refund reserve/approval/read-back, partial refund allocation,
   payout reservation, duplicate request, webhook signature, read-back, timeout,
   reversal, and ledger invariants. These are software checks only.
4. **Live acceptance transactions:** With named consenting client and creator
   pilot accounts, approved live providers, and a pre-agreed capped amount,
   complete an accepted booking and a real PayFast payment. Obtain PayFast's
   settlement statement with the matching merchant payment ID and actual fee.
   Then execute and read back a small refund. Separately complete the booking,
   verify the creator bank method, fund the Stitch float, request one payout,
   and verify the provider status and receiving bank statement. Do not use the
   same transaction as proof of both refund and payout acceptance.
5. **Independent review:** A PAPZ reviewer reconciles provider account/mode,
   payment and booking IDs, gross amount, 30/70 split, actual provider fee,
   refund amount, payout beneficiary and amount, status history, statement
   entries, webhook receipt, and ledger postings. Retain redacted evidence in
   the private production acceptance archive. No public endpoint or mock test
   may create provider-acceptance records.
6. **Register exact evidence:** The reviewed evidence must be bound to the
   exact PayFast merchant/live mode for refunds and exact Stitch client/live
   mode for payouts. Register distinct immutable acceptance records through a
   root-controlled deployment procedure and verify the capability read-back.
   The repository currently has the evidence table and fail-closed checks, but
   no reviewed live evidence records or operator-provisioned Stitch production
   configuration. Do not manufacture rows or use sandbox evidence as live
   evidence.
7. **Guarded activation:** After steps 1-6 pass, use the reviewed immutable
   backend revision and guarded deployment process. Enable refund/payout
   execution, verify API and worker configuration agree, run readiness and
   reconciliation probes, and only then enable public checkout. Checkout stays
   denied unless live refunds and creator payouts both pass readiness. Confirm
   rollback by returning all money-movement flags to false.
8. **Operational controls:** Before opening to customers, assign daily
   settlement/refund/payout reconciliation, exception ownership, support and
   escalation, chargeback/fraud handling, cash/float monitoring, access review,
   and incident/rollback responsibility. Alert on unknown provider status,
   callback mismatch, stale accepted operations, ledger imbalance, and low
   Stitch float. Run a restore and replay/reconciliation rehearsal.

## Internal Team Acceptance Lane

Internal testers must exercise the same booking and payment screens, APIs,
callbacks, and ledger rules that will ship, against an isolated QA backend and
database. Do not point synthetic role, booking, message, or payment fixtures at
production. The separate `internal-qa` EAS profile now points to the QA API;
`beta-testing` and production remain pointed at the production API.

Current QA recheck (15 October 2026): the isolated API and worker are running on
`papzi-prod-a1`; QA is routed through the existing Traefik HTTPS ingress at
`https://papzii-qa.129.151.188.15.nip.io`. The API still binds host port 18000 to
loopback. TLS validates; `/health` reports `qa`, `/health/contract` reports a
complete PostgreSQL schema, and the routing probe returns real OSRM geometry.
The `internal-qa` EAS profile resolves correctly, uses the EAS `preview`
environment, keeps digital purchases disabled, and does not alter production
build configuration. The QA update script preserves the public base URL and
reconnects the API container to the proxy network.

This is infrastructure/client-targeting progress, not financial acceptance.
The QA container currently has no PayFast merchant credentials, refund
acceptance record, Stitch payout credentials, SMTP credentials, LiveKit
credentials, canary tester IDs, or instant-dispatch setting. Consequently QA
checkout/refunds, payouts, account recovery, video and canary-only dispatch are
not currently enabled. Production has live-mode PayFast and some operational
provider settings; those secrets were not copied into QA. The owner-reported
successful sandbox checkout remains accepted as prior evidence, but the
credentials are not provisioned in this isolated runtime and do not prove
refund/payout settlement. The VM root disk remains 94% used (1.6 GB free); avoid
image pulls/rebuilds or broad Docker pruning until image size and rollback space
are checked.

Before calling the internal lane feature-complete:

1. Keep synthetic users and bookings in the QA database. Confirm enrollment,
   rate limits, abuse controls, upload limits, and QA data retention are
   appropriate for the HTTPS tester endpoint.
2. Build and submit only the `internal-qa` profile to TestFlight internal and
   Play internal testing; it is not a public-review candidate. Production builds
   must continue to target the production API.
3. The owner reports that PayFast sandbox payments have been tested
   successfully; retain that as completed sandbox evidence, not as proof of
   live-money settlement or every downstream workflow. Provision the actual
   sandbox credentials through the protected server configuration path, then
   record the tested app build, API revision, transaction reference, callback
   outcome and ledger reconciliation (with secrets and personal data redacted).
   Verify any untested cases in sandbox: failed and duplicate
   callbacks, payment history, cancellation, full and partial refunds,
   idempotent retry/read-back, and the actual client/provider/admin UI. Do not
   repeat already-passed cases unless the build or integration changed.
   The current source exposes accepted sandbox refund capability only when
   `APP_ENV=qa`; production readiness continues to reject sandbox refunds. The
   QA server must also have the sandbox refund flag, matching acceptance record,
   and isolated database configured before a refund can execute.
4. For creator payouts, use an approved Stitch sandbox if PAPZ obtains one. If
   none exists, use the isolated provider simulator only to verify UI, idempotent
   API commands, ledger states, webhook verification and failure recovery; label
   the result simulated and never show it as settled money. Real bank settlement
   remains a separate capped acceptance gate.
5. Seed clearly synthetic QA-only accounts for client, photographer, model and
   admin roles; test independent-account permissions and all key journeys on
   physical iOS and Android devices. Capture traces, build IDs and sanitized
   evidence. Do not reuse real creators' profiles or credentials as fixtures.

This lane lets the team validate valuable payment features without charging
customers or pretending production payouts exist. Production flags remain
fail-closed until provider onboarding and separate live-settlement sign-off.
The owner's successful sandbox-payment report supersedes any earlier implication
that sandbox payment testing had not occurred. Refund and payout coverage must be
tracked separately from checkout unless the existing test evidence explicitly
shows those flows passed too.

## Release acceptance matrix

| Journey | Required evidence | Must remain blocked until |
| --- | --- | --- |
| Checkout | Authorized client, server quote, accepted booking, successful PayFast ITN validation, one completed payment, correct 30/70 allocations, statement gross/fee/net match | Live merchant verification, callback reachability, settlement evidence, and refund plus payout capability acceptance |
| Refund | Authenticated client request, admin decision, one provider submission, PayFast refund-history read-back, prorated ledger entries and buyer notice | PayFast live refund access and independently reviewed transaction evidence |
| Creator payout | Approved creator, completed booking, verified bank method, available-balance reservation, Stitch webhook and API read-back, matching bank receipt | Stitch contract/scope, funded float, webhook secret, live acceptance transfer, and independent reviewer evidence |
| Reconciliation | Every payment/refund/payout matched by provider and internal references; no unexplained gross, fee, net, refund, or payout variance | Fee/settlement reporting and named finance owner |

## Store scope

The initial product is a marketplace for real photography/model services. Keep
checkout limited to eligible physical or person-to-person services. Any digital
content, recorded service, subscription, or in-app feature must be classified
separately and use the applicable Apple/Google billing route. Store compliance
does not certify merchant settlement or financial operations.

References: [PayFast API](https://developers.payfast.co.za/api), including its
refund query/history and transaction-history gross/fee/net fields;
[Stitch Disbursements](https://docs.stitch.money/payment-products/payouts/disbursements),
including the South African float-account requirement;
[Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/);
[Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738).
