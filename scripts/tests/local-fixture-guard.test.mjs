import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('legacy fixture sweep refuses hosted data before creating test users', () => {
  const result = spawnSync(process.execPath, ['scripts/e2e-full-app-sweep.mjs'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, SUPABASE_URL: 'https://hosted-fixtures.invalid', PAPZII_ALLOW_LOCAL_SUPABASE_FIXTURES: 'true' },
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('Legacy Supabase sweep requires explicit local fixtures'));
});
