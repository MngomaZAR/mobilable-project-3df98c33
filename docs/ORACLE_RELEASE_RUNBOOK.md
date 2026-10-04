# Oracle Release Runbook

Scope: Jones Madunga's existing Papzi Oracle host, `129.151.188.15`, Johannesburg.
This promotes a backend candidate; it does not publish a mobile app or certify
financial, native-device or app-store acceptance.

## Current Runtime

- Public API: `https://papzii-api.129.151.188.15.nip.io`.
- Backend source: `db425300d65f7f6336f9b6c7c99bfb2bf31927c8`.
- API image: `ghcr.io/mngomazar/papzi-api@sha256:30736430ac0c5a497530a8bf0306b4098385adbf21f7dbd799da1fb9a470a49b`.
- Worker image: `ghcr.io/mngomazar/papzi-worker@sha256:8dddd93a984d5e10b821a9d344287be630e3e24d91381feca7f881fc7c4fe2c8`.
- Stable services: `papzii-api`, `papzii-worker-1`, `papzii-postgres` and existing
  storage/proxy networks. API/worker are pinned; PostgreSQL and object volumes remain.
- Active database: `papzii_rollback_20261004t012626z`. This is the restored **real
  production dataset**, not QA data. Both writers use this exact source. Do not
  point them back to the older `papzii` database merely because its name looks nicer.
- All 12 ledger migrations applied. Runtime schema mutation is disabled.

## Promotion Procedure

1. Verify CI/protocol results for the exact backend revision and both GHCR digests.
   Run `python -m unittest discover -s deployment/tests -v` for release-helper guards.
2. On Oracle, run `deployment/oracle_release.py` as root with `--revision`,
   `--api-image`, `--worker-image` and `--compatibility-sql`. Keep the deployment
   folder layout intact. It restores a protected production dump into a separate
   rehearsal database, applies migrations and compares protected identities.
3. Inspect the root-only `rehearsal.json` receipt. Unknown/active legacy dispatch
   records, wrong database identity, wrong image labels or changed identities stop
   the process. Expired legacy offers are archived, never converted into new offers.
4. Run `deployment/oracle_promote.py` as root with `--rehearsal` pointing to that
   receipt and the same `--compatibility-sql`. It verifies unchanged source/image
   identity, locks the release, enables HTTP 503 maintenance and stops both writers.
5. It creates a fresh frozen database backup and object-volume archive, migrates
   existing data, replaces only API/worker images and checks the new services behind
   maintenance. Public traffic reopens only after core acceptance succeeds.
6. Run `node scripts/audit-public-api.mjs` from the repository. Check `/version`,
   contract, readiness, road geometry and anonymous rejection, not `/health` alone.
7. Update release evidence. Do not start store builds while capability/device gates fail.

Resolved Compose configuration and backup files contain credentials/private user
data. They remain root-only on Oracle; never commit them or paste command logs.

## Rollback Boundary

Before traffic resumes, a failed cutover restores the frozen dump into a **separate**
rollback database and runs the previous images against it. The original database
is not deleted. After traffic resumes, automatic data rollback is forbidden because
it could discard new user writes. Repair forward or approve a reconciled rollback.

On 2026-10-04 the first guarded cutover reverted before reopening traffic because
the helper incorrectly checked revision on `/health`, rather than `/version`.
That checker was corrected and regression-tested. A fresh restore rehearsal passed;
cutover `20261004T013038Z` then succeeded with identities and object storage preserved.
This intermediate failure is part of the release record, not an omitted attempt.

Root-only receipts:

- `/var/backups/papzii/release-20261004T012942Z/rehearsal.json`.
- `/var/backups/papzii/cutover-20261004T013038Z/promotion.json`.
- Frozen dump SHA-256: `354121d245a68b7f0c7bfec5367fc92284403aede8a56770fab87c777528354c`.

Public core checks pass. The initial cutover failed seven capability checks;
operational configuration subsequently resolved admin allowlisting and recovery
email. The 07:40Z probe still failed five. See
[Integration Recovery](INTEGRATION_RECOVERY_20261004.md) for provider evidence.
Backup
retention scheduling, off-host protected copies, alert ownership and repeat restore
acceptance remain operational work. A backup on the same host is not disaster recovery.

## Configuration-Only Updates

Run `deployment/oracle_configure.py --expected-revision <exact-running-revision>`
as root on Oracle with a JSON request through stdin, never secret CLI arguments.
The helper locks the release, validates the exact running images and database,
backs up resolved Compose privately, updates only allowlisted server environment
keys in API and worker, and checks core acceptance. A failed change restores the
previous configuration without rolling back user data.

Owner admin addition requires one active, verified account matching the specified
email. Existing allowlisted administrators are preserved. Integration settings
must not change image versions, database identity, public URL, runtime schema
policy or financial acceptance records.

Merchant settings must be submitted together with `PAYFAST_CHECKOUT_ENABLED=false`.
The helper refuses an image lacking the default-off checkout guard and refuses
in-place merchant rotation. Independently accepted payments/refunds/payouts are
required before a separately reviewed activation; this helper cannot enable it.
