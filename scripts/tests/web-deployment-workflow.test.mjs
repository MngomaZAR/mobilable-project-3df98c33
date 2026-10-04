import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

const source = fs.readFileSync(new URL('../../.github/workflows/eas-deploy-web.yml', import.meta.url), 'utf8');
const workflow = yaml.load(source);
const steps = workflow.jobs.deploy.steps;

test('web export shares the existing EAS environment with full release validation', () => {
  const validation = steps.findIndex(step => step.run === 'eas env:exec production "npm run check:release" --non-interactive');
  const deploy = steps.findIndex(step => step.run?.startsWith('eas deploy '));
  assert.ok(validation >= 0 && deploy > validation);
  assert.equal(steps[validation].continue_on_error, undefined);
  assert.equal(steps[validation]['continue-on-error'], undefined);
  assert.equal(source.includes('.env.eas.production'), false);
});

test('web deployment is explicit, least-privilege and pinned', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(steps.find(step => step.uses === 'expo/expo-github-action@v8').with['eas-version'], '24.10.0');
  assert.equal(steps.find(step => step.run?.startsWith('eas deploy ')).run,
    'eas deploy --prod --environment production --non-interactive');
});

test('locked compiler dependencies are not omitted', () => {
  assert.equal(steps.find(step => step.name === 'Install dependencies').run, 'npm ci --no-audit --no-fund');
});
