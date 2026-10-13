import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('legacy dashboard fixture writes are guarded before creating the admin client', () => {
  const source = fs.readFileSync(new URL('../../e2e-web/role.dashboard.spec.js', import.meta.url), 'utf8');
  const preparation = source.slice(source.indexOf('async function prepareRoleAccounts()'));
  const guarded = preparation.indexOf("PAPZII_ALLOW_LOCAL_SUPABASE_FIXTURES !== 'true'");
  const client = preparation.indexOf('const admin = createClient');
  assert.ok(guarded >= 0 && guarded < client);
  assert.match(preparation.slice(0, client), /\['127\.0\.0\.1', 'localhost', '\[::1\]'\]\.includes\(fixtureHost\)/);
  assert.match(preparation.slice(0, client), /throw new Error/);
  assert.match(source, /Legacy local fixtures only; current release roles are tested by oracle\.roles\.spec\.js/);
});
