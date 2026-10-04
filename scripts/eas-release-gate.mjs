import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadLocalEnv } from './lib/load-env-file.mjs';

const storeTargets = new Set(['appstore', 'play', 'both']);

export function isRestrictedTestingProfile(env) {
  return String(env.EAS_BUILD_PROFILE || '').trim().toLowerCase() === 'beta-testing';
}

export function assertRestrictedTestingConfig(env) {
  if (String(env.EXPO_PUBLIC_STORE_TARGET || '').trim().toLowerCase() !== 'internal'
      || env.EXPO_PUBLIC_RESTRICTED_BETA !== 'true'
      || env.EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES !== 'true'
      || env.EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER !== 'disabled'
      || env.EXPO_PUBLIC_BACKEND_PROVIDER !== 'api'
      || env.EXPO_PUBLIC_APP_ENV !== 'beta') {
    throw new Error('Restricted testing requires hosted API mode, internal scope and all purchasing disabled.');
  }
}

export function shouldValidateRelease(env) {
  const profile = String(env.EAS_BUILD_PROFILE || '').trim().toLowerCase();
  const target = String(env.EXPO_PUBLIC_STORE_TARGET || '').trim().toLowerCase();
  return /^production(?:-|$)/.test(profile) || storeTargets.has(target);
}

const script = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  loadLocalEnv();
  if (shouldValidateRelease(process.env) || isRestrictedTestingProfile(process.env)) {
    const env = { ...process.env };
    if (isRestrictedTestingProfile(env)) {
      try { assertRestrictedTestingConfig(env); }
      catch (error) { console.error(error.message); process.exit(1); }
      console.log('Restricted beta only: hosted API/contract/routing checks run; public readiness is not claimed.');
    }
    // A renamed target must not bypass public readiness on a production profile.
    if (!isRestrictedTestingProfile(env) && !storeTargets.has(String(env.EXPO_PUBLIC_STORE_TARGET || '').trim().toLowerCase())) {
      env.EXPO_PUBLIC_STORE_TARGET = 'both';
    }
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./validate-env.mjs', import.meta.url)), '--mode=release'], { env, stdio: 'inherit' });
    if (result.error) console.error('Unable to run the release environment gate. Build blocked.');
    process.exit(result.status ?? 1);
  }
  console.log('Non-store development/preview build: public release readiness is not claimed.');
}
