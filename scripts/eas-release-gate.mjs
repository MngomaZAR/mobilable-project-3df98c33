import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadLocalEnv } from './lib/load-env-file.mjs';

const storeTargets = new Set(['appstore', 'play', 'both']);

export function shouldValidateRelease(env) {
  const profile = String(env.EAS_BUILD_PROFILE || '').trim().toLowerCase();
  const target = String(env.EXPO_PUBLIC_STORE_TARGET || '').trim().toLowerCase();
  return /^production(?:-|$)/.test(profile) || storeTargets.has(target);
}

const script = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  loadLocalEnv();
  if (shouldValidateRelease(process.env)) {
    const env = { ...process.env };
    // A renamed target must not bypass public readiness on a production profile.
    if (!storeTargets.has(String(env.EXPO_PUBLIC_STORE_TARGET || '').trim().toLowerCase())) {
      env.EXPO_PUBLIC_STORE_TARGET = 'both';
    }
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./validate-env.mjs', import.meta.url)), '--mode=release'], { env, stdio: 'inherit' });
    if (result.error) console.error('Unable to run the release environment gate. Build blocked.');
    process.exit(result.status ?? 1);
  }
  console.log('Non-store development/preview build: public release readiness is not claimed.');
}
