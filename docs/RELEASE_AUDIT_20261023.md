# Papzii Release-Candidate Audit - 2026-10-23

## Scope and source of truth

This audit uses `release/testflight-2026-06` as the production-candidate base,
not `main`. The implementation repairs are being reviewed through PR #12 from
`codex/map-keyboard-layout`.

## Verified in this worktree

- The map talent sheet repair is committed in `82ad43a`; it caps expanded sheet
  height, tracks keyboard height, keeps controls above the keyboard and lets a
  user dismiss the keyboard from the sheet handle or list drag.
- The focused MapScreen workflow suite previously passed: 10 tests.
- Backend CORS-origin regression tests passed on 2026-10-23: 3 tests. The
  production default remains restricted to the two Papzii HTTPS origins; no
  localhost or wildcard origin was added to production.
- The focused browser auth smoke test passed on 2026-10-23. It uses controlled
  discovery fixtures rather than attempting cross-origin requests from a local
  web server to the production API.
- `ff1e2a1` changes the EAS Hosting continuous-deploy trigger from stale
  `main` to `release/testflight-2026-06`.
- REA static evidence covers 380 relevant files and confirms code exists across
  discovery, bookings, chat, KYC, media, moderation, payments, payouts,
  dispatch, video, notifications and admin. Static evidence is not runtime
  acceptance evidence.

## Engineering decisions

1. Small, separately testable changes are required for release work.
2. Production CORS must remain explicit; an end-to-end browser test must use a
   real allowed HTTPS origin or local fixtures, never weaken production CORS.
3. A build must declare its release branch and environment deterministically.
   Inspect the Expo/EAS environment supplied to every build before submission.
4. A feature is ready only when its UI, authorization, persisted state,
   background events, error/retry path and role-specific device acceptance have
   evidence from the same deployed environment.

## Remaining release gates

The runtime record dated 2026-10-15 reports the core API healthy, but reports
these capabilities unavailable or unaccepted: enabled checkout, live refund
execution, creator-bank payout execution, live video and instant dispatch.
Actual provider arrangements and real-device acceptance remain required. These
cannot be completed safely by changing feature flags or test fixtures.

## Local open-source fallback

Ollama and OpenCode are installed locally. OpenCode is configured to use the
local `qwen2.5-coder:1.5b` model via `http://127.0.0.1:11434/v1`. This is an
offline drafting and inspection fallback, not a release authority and not a
holder of cloud credentials, browser sessions or store-account access. Do not
copy secrets or personal data into local-model prompts. Larger Kimi/DeepSeek
models should only be installed after checking disk/RAM and their license;
they are not required to validate this release.
