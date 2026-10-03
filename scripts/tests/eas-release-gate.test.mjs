import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldValidateRelease } from '../eas-release-gate.mjs';

test('development build is not a public release', () => {
  assert.equal(shouldValidateRelease({ EAS_BUILD_PROFILE: 'development' }), false);
});

test('explicit internal preview does not claim public readiness', () => {
  assert.equal(shouldValidateRelease({ EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_STORE_TARGET: 'internal' }), false);
});

test('production must validate even when target is changed to internal', () => {
  assert.equal(shouldValidateRelease({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_STORE_TARGET: 'internal' }), true);
});

test('inherited local-signing production profile must validate', () => {
  assert.equal(shouldValidateRelease({ EAS_BUILD_PROFILE: 'production-ios-local' }), true);
});

test('all store targets validate on any profile', () => {
  for (const target of ['appstore', 'play', 'both']) {
    assert.equal(shouldValidateRelease({ EAS_BUILD_PROFILE: 'custom', EXPO_PUBLIC_STORE_TARGET: target }), true);
  }
});

test('profile and target whitespace/case do not bypass the gate', () => {
  assert.equal(shouldValidateRelease({ EAS_BUILD_PROFILE: ' Production ', EXPO_PUBLIC_STORE_TARGET: 'BOTH' }), true);
});
