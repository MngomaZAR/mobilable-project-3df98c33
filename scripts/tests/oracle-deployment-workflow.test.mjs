import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

const workflow = yaml.load(fs.readFileSync(new URL('../../.github/workflows/deploy-backend-oracle.yml', import.meta.url), 'utf8'));
const job = workflow.jobs.deploy;
const steps = job.steps;

test('Oracle deployment requires successful CI and backend builds for its full revision', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.revision.required, true);
  const gate = steps[0].run;
  assert.ok(gate.includes('^[0-9a-f]{40}$'));
  assert.ok(gate.includes("'CI' 'Build Backend Images'"));
  assert.ok(gate.includes('.head_sha == $sha and .conclusion == "success"'));
  assert.equal(steps.find(step => step.uses === 'actions/checkout@v4').with.ref, '${{ inputs.revision }}');
});

test('Oracle deployment pins images and host identity before running guarded promotion', () => {
  const resolve = steps.findIndex(step => step.id === 'images');
  const promote = steps.findIndex(step => step.name === 'Rehearse and promote through Oracle release helpers');
  const verify = steps.findIndex(step => step.name === 'Verify public revision and schema');
  assert.ok(resolve > 0 && promote > resolve && verify > promote);
  assert.ok(steps[resolve].run.includes('sha256:[0-9a-f]{64}'));
  assert.ok(steps[promote].run.includes('StrictHostKeyChecking=yes'));
  assert.ok(steps[promote].run.includes('UserKnownHostsFile="$hosts"'));
  assert.ok(steps[promote].run.includes('promote-oracle-candidate.sh'));
  assert.ok(steps[verify].run.includes('.version == $sha'));
  assert.equal(job['timeout-minutes'], 40);
  assert.deepEqual(workflow.concurrency, { group: 'oracle-production', 'cancel-in-progress': false });
  assert.equal(job.environment, 'production');
  assert.equal(steps.some(step => step['continue-on-error']), false);
});

test('Oracle wrapper rehearses before promotion and verifies preserved identities', () => {
  const script = fs.readFileSync(new URL('../../deployment/promote-oracle-candidate.sh', import.meta.url), 'utf8');
  assert.ok(script.indexOf('oracle_release.py" --revision') < script.indexOf('oracle_promote.py" --rehearsal'));
  assert.ok(script.includes('r["production_replaced"] and r["identities_preserved"]'));
  assert.ok(script.includes('r["revision"] == sys.argv[2]'));
  assert.equal(/PAYFAST_CHECKOUT_ENABLED|STITCH_PAYOUTS_ENABLED|PAYFAST_REFUNDS_ENABLED/.test(script), false);
  const payload = script.match(/printf '%s\\n' '(\{"updates":.+\})' \| python3/);
  assert.ok(payload, 'Configuration helper needs the updates envelope');
  assert.deepEqual(JSON.parse(payload[1]), { updates: { COMMISSION_RATE: '0.30' } });
});
