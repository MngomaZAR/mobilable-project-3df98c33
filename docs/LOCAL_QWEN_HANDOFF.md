# Papzii Local AI Continuation

## Scope and source of truth

- Repository: `MngomaZAR/mobilable-project-3df98c33`
- Production candidate branch: `release/testflight-2026-06`
- Do not use `main` as the deployment source without reconciling it with the release branch.
- Work in a new branch from the release branch. Keep each repair small, testable, and reviewable.
- Treat deployed systems, credentials, provider dashboards, and real-money activity as external state. Inspect them before changing them and never invent their status.

## Current repair

This worktree is on `codex/map-keyboard-layout`. The map keyboard repair in
`src/screens/MapScreen.tsx` and `__tests__/MapScreen.workflow.test.tsx` was
committed as `82ad43a` and is followed by the release-verification repair
`ff1e2a1`.

Problem: the map talent sheet and floating controls overlapped the bottom navigation and keyboard. The repair makes sheet sizing viewport-aware, caps the expanded sheet height, moves the sheet and controls above the keyboard, and dismisses the keyboard when the sheet is dragged or its handle is pressed.

Validate before committing:

```powershell
npm test -- --runInBand __tests__/MapScreen.workflow.test.tsx
npm run typecheck
npm run lint
```

If a command fails, diagnose the actual failure before editing. Do not change unrelated code merely to make a test green.

## Known platform facts

- Papzii is operated by PAPZ (Pty) Ltd, registration `2025/188861/07`.
- PayFast sandbox checkout has been exercised. Provider acceptance for live refunds and creator payouts has not been demonstrated.
- Creator settlement is the critical unresolved business integration. Do not enable public paid checkout until refund and creator-settlement paths are contractually and technically ready.
- The stated commercial split is 30% Papzii and 70% creator, with processing costs funded from Papzii's share. Reconcile it across quote, payment, refund, ledger, payout, UI and terms before release.
- Pilot creators are `smngoma22@gmail.com` and `jonesmadunga@gmail.com`. They require their own actual onboarding, consent, KYC and payout configuration; never fake approved status.
- TestFlight/Play internal testing builds must be produced only from a verified release commit and a QA environment that has the integrations required by the test plan.

## Evidence from static analysis

REA was run against a read-only `git archive` snapshot of release commit `ef81f7043d665fcb6917f8c0e26351ff8b997668`. It parsed 380 files and identified existing UI, service and serverless domains for map/discovery, bookings, chat, media, KYC, moderation, payments, payouts, dispatch, video and admin. This supports repairing and connecting the existing product rather than copying another company's code.

## Release acceptance standard

For each role (client, creator, model, admin), verify on real devices:

1. Sign-up, sign-in, password recovery, consent and account deletion.
2. Profile/KYC submission, safe handling of rejected and pending states.
3. Search/map, location denial, keyboard, rotation, small screen and tablet layouts.
4. Availability, pricing, booking request, acceptance/rejection, cancellation and messaging.
5. Payment intent, provider redirect/webhook, receipt, ledger, refund, settlement and support escalation.
6. Feed/media creation, moderation/reporting, notification and privacy controls.
7. Server restart, offline/reconnect behavior, retries and idempotent webhooks.
8. Backups, monitoring, least-privilege access and recovery procedures.

Do not call the product production ready until the applicable live or sandbox evidence exists for every enabled feature.

## Local model boundaries

The local Qwen runtime can read this workspace and help draft, inspect and run local commands from VS Code. It does not automatically inherit this Codex conversation, browser sessions, credentials, cloud access, store accounts, or the authority to submit releases. Keep secrets in approved environment stores and redact them from prompts, logs, commits and docs.
