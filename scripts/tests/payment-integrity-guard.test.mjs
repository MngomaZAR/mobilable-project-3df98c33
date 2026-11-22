import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(
  path.resolve(import.meta.dirname, "../../backend/api/migrations/20261122092000_payment_integrity_guard.sql"),
  "utf8",
);

test("payment completion requires a provider transaction id", () => {
  assert.match(migration, /payments_completed_requires_provider_id/i);
  assert.match(migration, /status\s+NOT IN\s*\('completed',\s*'paid'\)/i);
  assert.match(migration, /NULLIF\(TRIM\(provider_payment_id\),\s*''\)\s+IS NOT NULL/i);
  assert.match(migration, /NOT VALID/i);
});

test("payment guard preserves legacy rows for explicit reconciliation", () => {
  assert.match(migration, /Existing legacy rows are intentionally left untouched/i);
  assert.doesNotMatch(migration, /UPDATE\s+payments|DELETE\s+FROM\s+payments/i);
});
