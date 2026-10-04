import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

const source = fs.readFileSync(new URL('../../.github/workflows/deploy-backend-dokploy.yml', import.meta.url), 'utf8');
const workflow = yaml.load(source);
const job = workflow.jobs.deploy;
const steps = job.steps;

test('backend deployment verifies the image-producing commit rather than a floating default branch', () => {
  assert.equal(job.env.EXPECTED_REVISION,
    '${{ github.event.workflow_run.head_sha || inputs.revision || github.sha }}');
  assert.equal(workflow.on.workflow_dispatch.inputs.revision.type, 'string');
  assert.deepEqual(workflow.on.workflow_run.branches, ['main']);
});

test('backend configuration is validated before mutation and exact serving identity afterwards', () => {
  const validate = steps.findIndex(step => step.name === 'Validate intended production revision and endpoint configuration');
  const redeploy = steps.findIndex(step => step.name === 'Trigger Dokploy compose redeploy');
  const verify = steps.findIndex(step => step.name === 'Verify exact serving revision, schema and public capabilities');
  assert.ok(validate >= 0 && redeploy > validate && verify > redeploy);
  assert.ok(steps[validate].run.includes('--validate-only'));
  assert.ok(steps[verify].run.includes('--revision "$EXPECTED_REVISION"'));
  assert.equal(steps[verify].run.includes('--validate-only'), false);
  assert.equal(steps[verify]['continue-on-error'], undefined);
  for (const step of steps.slice(validate)) {
    assert.equal(step.if, "steps.dokploy_config.outputs.configured == 'true'");
  }
});

test('backend deploys are serialized, bounded and least-privilege', () => {
  assert.deepEqual(workflow.concurrency, { group: 'dokploy-production', 'cancel-in-progress': false });
  assert.equal(job['timeout-minutes'], 15);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const redeploy = steps.find(step => step.name === 'Trigger Dokploy compose redeploy').run;
  assert.ok(redeploy.includes('--connect-timeout 10 --max-time 30'));
  assert.equal(redeploy.includes('--fail-with-body'), false);
  assert.ok(redeploy.includes('> /dev/null'));
});

test('unconfigured automatic runs cannot imply that production was deployed', () => {
  const check = steps.find(step => step.id === 'dokploy_config').run;
  assert.ok(check.includes('Production was NOT deployed'));
  assert.ok(check.includes('configured=false'));
  assert.ok(check.includes("= \"workflow_dispatch\""));
});
