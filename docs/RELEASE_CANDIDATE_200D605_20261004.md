# Candidate 200d605 Deployment Evidence

October 4, 2026. Delivered for restricted testing, not a complete publicly
accepted marketplace. Upload, beta availability, device acceptance and public
store approval are separate evidence levels.

## Exact Runtime And Preservation

- Source: `200d60599c92c800ab29bba6eb8b4a4a1b7cfdf6`.
- Oracle API: `https://papzii-api.129.151.188.15.nip.io`, Jones Madunga's existing host.
- API image: `ghcr.io/mngomazar/papzi-api@sha256:b170091c1b3646693407f966583d0a0360da178f82160642f9385722480b1ca4`.
- Worker image: `ghcr.io/mngomazar/papzi-worker@sha256:bb782614ef5301b316affab86d221624caf82acfcea2c9a69861fb68e268b102`.
- Restore rehearsal: `20261004T145030Z`, all 13 migrations; backup SHA-256
  `b3c13995ee63c39db8b93a372730c7282f03f76073a86b88f94a00d3c44c26ca`.
- Protected cutover: `20261004T145154Z`; frozen backup SHA-256
  `3cf649f407a61ff2b071efce1dca0469e556b1da84c43463c4d24c3571cc36a7`.
- Actual production identities, sessions, business rows, credentials and object
  storage preserved; no QA clone replaced the production database.
- HTTPS health/version/schema, anonymous-auth rejection and 122-point road route
  passed. Actual admin serialization accepts the server allowlist and rejects
  forged metadata. API and worker use the same production database.
- Existing EAS/GitHub release endpoint remains this public HTTPS API in `api`
  mode. No server secret or SSH tunnel was put into public mobile variables.

## Checks And Limits

- [Frontend CI 37210220924](https://github.com/MngomaZAR/mobilable-project-3df98c33/actions/runs/37210220924):
  369 tests / 35 suites, typecheck, lint, architecture and safety jobs passed.
- [Backend CI 37210248553](https://github.com/MngomaZAR/mobilable-project-3df98c33/actions/runs/37210248553):
  349 API / 26 worker tests, database fixtures enabled, no skips; both image
  architectures published successfully.
- Load: 100 clients, 100 photographers and 100 models; 3,000 reads, no errors,
  read p95 997.77 ms. Two hundred booking/chat journeys, 1,400 requests, no errors,
  write p95 4,340.26 ms remains above target. Gateways/media were not live load.
- Durable worker: 811 completed fixture jobs, 810 notification rows, zero unmapped
  destinations. Rows do not establish physical-device push delivery.
- Static audits: 44 screen modules, 147 runtime files and 46 table contracts,
  without findings in their recorded scope. This is not every native control.
- [Matching web preview](https://papzi--swvsndvpq2.expo.app): client sign-in, five
  primary tabs and sign-out passed at phone/desktop widths, actual tile/canvas
  rendering (12/24 tiles), no API errors/crashes/horizontal overflow. Screenshots
  and dedicated reviewer credentials remain private.
- The map enters server-priced scheduling for the correct provider; route state
  is destination-bound, failed/stale geometry clears, and ETA requires a real road
  duration. See [Native Map Follow-Up](NATIVE_MAP_ACCEPTANCE_20261004.md).

## Distribution

- iOS EAS build `4bac4c43-00a3-4774-a901-5d132596b567`, version `1.0.0 (41)`;
  upload `cbfae5a4-beca-4f6a-b172-93dd576df956` finished. Apple reports VALID,
  internal/external `IN_BETA_TESTING`, assigned to the existing two groups.
- Android EAS build `86de4fe4-9d56-4b09-9cf8-ff15e017eb4e`, code `4`;
  upload `9058d4f2-9214-472f-a75b-ab6690939d6b` finished. Owner-authorized internal
  rollout activated in Console; independent Publisher readback confirms completed.
- Two TestFlight instruction emails SMTP-accepted; no confirmed inbox/device
  results, duplicate join invitation, new group or public link.
- Subsequent documentation/build-gate commits do not replace these binaries or
  runtime images. See [Testing Release](TESTING_RELEASE_20261004.md).

## Open Public Gates

Readiness still returns false for checkout activation, refund execution, creator
bank payout execution, device video and instant dispatch acceptance. No provider
acceptance, charge, refund, bank settlement or device result was fabricated.
All-role/native/all-control accessibility tests, storage/dependency security,
off-host restore/rollback/monitoring acceptance and write latency remain open.

Play has incomplete app setup and zero opted-in closed-testers against its
12-real-testers/14-days requirement. Public legal links return 404, while old
native legal copy contains unsupported promises. Public Apple review is unsubmitted;
Play production is empty. [Public Store Gates](PUBLIC_STORE_GATES_20261004.md)
records these separate blockers. Beta distribution is not public launch or
Uber/Airbnb-level proof.
