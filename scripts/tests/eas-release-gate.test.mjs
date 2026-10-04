import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRestrictedTestingConfig, isRestrictedTestingProfile, shouldValidateRelease } from '../eas-release-gate.mjs';

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

const beta = {
  EAS_BUILD_PROFILE: 'beta-testing', EXPO_PUBLIC_APP_ENV: 'beta',
  EXPO_PUBLIC_STORE_TARGET: 'internal', EXPO_PUBLIC_RESTRICTED_BETA: 'true',
  EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES: 'true', EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER: 'disabled',
  EXPO_PUBLIC_BACKEND_PROVIDER: 'api',
};

test('explicit restricted beta is independently checked, not a public release', () => {
  assert.equal(isRestrictedTestingProfile(beta), true);
  assert.equal(shouldValidateRelease(beta), false);
  assert.doesNotThrow(() => assertRestrictedTestingConfig(beta));
});

test('restricted beta cannot enable purchasing, change scope, or use legacy backends', () => {
  for (const [key, value] of Object.entries(beta).filter(([key]) => key !== 'EAS_BUILD_PROFILE')) {
    assert.throws(() => assertRestrictedTestingConfig({ ...beta, [key]: '' }), key);
    assert.equal(value.length > 0, true);
  }
  assert.throws(() => assertRestrictedTestingConfig({ ...beta, EXPO_PUBLIC_STORE_TARGET: 'both' }));
  assert.throws(() => assertRestrictedTestingConfig({ ...beta, EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER: 'external' }));
  assert.equal(isRestrictedTestingProfile({ EAS_BUILD_PROFILE: 'production' }), false);
});
