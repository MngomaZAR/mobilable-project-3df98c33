import { spawnSync } from 'node:child_process';
import { assertStoreBuild } from './assert-store-build.mjs';

const [platform, id] = process.argv.slice(2);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 300000, ...options });
  if (result.error || result.status !== 0) throw new Error('Store preflight or submission command failed. No success receipt was recorded.');
  return result.stdout;
}

try {
  const revision = command('git', ['rev-parse', 'HEAD']).trim();
  // Validate user input before invoking a shell-backed command on Windows.
  assertStoreBuild({ id, status: 'FINISHED', platform: platform?.toUpperCase(), gitCommitHash: revision,
    buildProfile: 'production' }, { id, platform, revision });
  if (command('git', ['status', '--porcelain', '--untracked-files=normal']).trim()) throw new Error('Commit the candidate changes before selecting its store artifact.');
  command(process.execPath, ['scripts/validate-env.mjs', '--mode=release'], { stdio: 'inherit' });
  const cliOptions = { shell: process.platform === 'win32' };
  const build = JSON.parse(command(npx, ['eas-cli@24.10.0', 'build:view', id, '--json'], cliOptions));
  console.log(JSON.stringify(assertStoreBuild(build, { id, platform, revision })));
  command(npx, ['eas-cli@24.10.0', 'submit', '--platform', platform, '--profile', 'production', '--id', id,
    '--non-interactive', '--wait'], { ...cliOptions, stdio: 'inherit', timeout: 3600000 });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
