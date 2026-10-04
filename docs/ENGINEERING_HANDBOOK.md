# Engineering Handbook

## Delivery Credits

Project-owner-provided attribution: **SAICTS** ([saicts.co.za](https://saicts.co.za))
is the contracted builder. **Samkelo Mngoma**, COO of SAICTS, is the developer,
engineer and contracted builder lead. This records the owner's description, not
an independently verified employment record or an invented staff roster.

## Responsibilities

| Responsibility | Required Record |
|---|---|
| Product and delivery | Ordered scope, acceptance criteria, priority and open dependencies. |
| Domain engineering | Server-owned rules, migrations, ownership checks and retry/idempotency tests. |
| Mobile engineering | Shared theme/navigation/service patterns, accessible actions and device acceptance. |
| QA | Exact revision, environment, actor, action, assertion and remaining untested scope. |
| Release and operations | Immutable image/build IDs, backup/restore evidence, rollback boundary and incident owner. |
| Financial and privacy operations | Merchant authority, settlement reconciliation, retention and approved declarations. |

These are responsibilities to assign, not claims that six staffed departments exist.

## Repository Rules

- Keep changes scoped to existing modules. Do not move the whole app into a new
  folder structure just to make the repository look like a larger team.
- Use domain commands for bookings, payments, identity decisions and moderation.
  Generic data access must retain server-side ownership and role checks.
- Apply numbered, checksummed migrations. Never rewrite an applied migration or
  replace production users with QA fixtures.
- Preserve drafts after failures; separate loading, empty, error and content states.
- Tests must assert observable behavior. Mock provider responses are protocol
  evidence, not proof of money, email, push or media delivery.
- Keep credentials, resolved Compose configuration, backups, auth traces, bundles
  and signed download links out of Git. Use existing server/EAS/GitHub entries.
- Link evidence to a revision. Passing checks on one revision does not validate a
  different public image, OTA update or installed store binary.
- Record historical reports unchanged; current status lives in
  [Release Status](RELEASE_STATUS.md). Do not describe skipped deployment as success.

## Definition of Done

A source change is complete after focused regression tests, type/lint checks,
relevant database protocols and a documented behavior change. A **public release**
also requires live domain acceptance, physical-device journeys, accessible enabled
screens, incident/backup ownership, financial acceptance and actual store review.
Compilation, a green workflow, an upload receipt and production availability are
four different facts.

Use [Marketplace Gaps](MARKETPLACE_GAP_ANALYSIS.md) for product priorities and
[Oracle Release Runbook](ORACLE_RELEASE_RUNBOOK.md) for guarded backend promotion.
