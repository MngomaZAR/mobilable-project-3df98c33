# Oracle Release Runbook

Scope: Jones Madunga's existing Papzi Oracle host, `129.151.188.15`, Johannesburg.
This promotes a backend candidate; it does not publish a mobile app or certify
financial, native-device or app-store acceptance.

## Current Runtime

- Public API: `https://papzii-api.129.151.188.15.nip.io`.
- Backend source: `200d60599c92c800ab29bba6eb8b4a4a1b7cfdf6`.
- API image: `ghcr.io/mngomazar/papzi-api@sha256:b170091c1b3646693407f966583d0a0360da178f82160642f9385722480b1ca4`.
- Worker image: `ghcr.io/mngomazar/papzi-worker@sha256:bb782614ef5301b316affab86d221624caf82acfcea2c9a69861fb68e268b102`.
- Stable services: `papzii-api`, `papzii-worker-1`, `papzii-postgres` and existing
  storage/proxy networks. API/worker are pinned; PostgreSQL and object volumes remain.
- Active database: `papzii_rollback_20261004t012626z`. This is the restored **real
  production dataset**, not QA data. Both writers use this exact source. Do not
  point them back to the older `papzii` database merely because its name looks nicer.
- All 13 ledger migrations applied. Runtime schema mutation is disabled.
- Delivered iOS 41 / Android code 4 match this restricted testing candidate.
  The later repository/deployment-helper revisions do not change these binaries.

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

The later payment activation guard passed CI and was promoted without changing
database or user identities. Its root-only receipts:

- `/var/backups/papzii/release-20261004T081807Z/rehearsal.json`.
- `/var/backups/papzii/cutover-20261004T082021Z/promotion.json`.
- Frozen dump SHA-256: `fa01a1fe608faf71b3696d80874f7f820e054625a291fcb0fc096389657cc354`.
- Merchant settings, with checkout paused:
  `/var/backups/papzii/configuration-20261004T082215Z/configuration.json`.

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
An existing recovery encryption key cannot be silently replaced by this helper;
key rotation must preserve the ability to decrypt pending recovery jobs.

## Bank Encryption Initialization

Only on the existing Oracle host, using the exact running revision:

```bash
printf '{}' | sudo python3 deployment/oracle_configure.py --expected-revision 200d60599c92c800ab29bba6eb8b4a4a1b7cfdf6 --initialize-bank-encryption
```

The explicit JSON input closes stdin; do not leave a remote configuration process
waiting for input while it holds the release lock. Upload the tested helper folder
before running the command; do not run it on the laptop or against the LMS host.

The helper generates a canonical 32-byte Fernet key on Oracle only when both
services lack one. It reuses an existing matching key, rejects mismatched or
partial runtime keys, and refuses a new key if any encrypted bank records exist.
Lost keys must be recovered, not replaced. An existing key cannot be rotated by
this operational helper. An isolated container performs an encryption/decryption
round trip before the runtime changes; database/image/core-health guards and
configuration rollback still apply. No payout flags or acceptance rows are added.

On October 4 at 16:39Z, initialization succeeded with zero existing bank rows,
zero financial operations and zero provider acceptances. Both running services
have the same key, retain the same database and immutable images, and keep runtime
schema changes disabled. The secret was not printed or committed. Private receipt:
`/var/backups/papzii/configuration-20261004T163900Z/configuration.json`.

A separate Windows user-scoped DPAPI recovery copy was created and its decryption
round trip verified. This does not establish complete off-site database/storage
disaster recovery; that remains a launch gate. Keep this key server-side and in
protected recovery storage, never in `EXPO_PUBLIC_*`, mobile manifests, public
repository variables or store metadata. Creator transfers still require an
authorized provider account, independent verification and confirmed settlement.

Primary reference: [Fernet key handling](https://cryptography.io/en/latest/fernet/).
