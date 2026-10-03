import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertStoreBuild } from '../assert-store-build.mjs';

const options = { id: '453b777d-465d-488d-9b08-859e77bd3c9f', platform: 'ios', revision: 'a'.repeat(40) };
const candidate = { id: options.id, platform: 'IOS', status: 'FINISHED', gitCommitHash: options.revision, buildProfile: 'production-ios-local', project: { id: 'f0c1ef90-ac26-4e4c-a799-77b377e2f452' } };
test('exact finished tested production artifact is accepted', () => {
  assert.equal(assertStoreBuild(candidate, options).id, options.id);
});
test('different source/platform/status/project/profile and missing ID fail closed', () => {
  for (const override of [{ gitCommitHash: 'b'.repeat(40) }, { platform: 'ANDROID' }, { status: 'ERRORED' }, { buildProfile: 'preview' }, { id: 'other' }, { project: { id: 'other' } }]) {
    assert.throws(() => assertStoreBuild({ ...candidate, ...override }, options));
  }
  assert.throws(() => assertStoreBuild(candidate, { ...options, id: '' }));
  assert.throws(() => assertStoreBuild(candidate, { ...options, id: '-'.repeat(36) }));
  assert.throws(() => assertStoreBuild(candidate, { ...options, platform: 'web' }));
});
