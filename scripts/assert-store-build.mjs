import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertStoreBuild(build, { id, platform, revision }) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id || '') || !/^[a-f0-9]{40}$/.test(revision || '') || !['ios', 'android'].includes(platform)) throw new Error('A specific build ID, platform and full source revision are required.');
  if (build?.id !== id || build?.status !== 'FINISHED') throw new Error('The selected build is not the finished requested artifact.');
  if (build.platform !== platform.toUpperCase() || build.gitCommitHash !== revision) throw new Error('The artifact platform/source does not match the checked-out tested source.');
  const profiles = platform === 'ios' ? ['production', 'production-ios-local'] : ['production'];
  if (!profiles.includes(build.buildProfile)) throw new Error('Only a store-signed production profile may be submitted.');
  if (build.project?.id && build.project.id !== 'f0c1ef90-ac26-4e4c-a799-77b377e2f452') throw new Error('The artifact belongs to a different EAS project.');
  return { id, platform, revision, profile: build.buildProfile, status: build.status };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const file = process.argv[2];
    const receipt = assertStoreBuild(JSON.parse(fs.readFileSync(file, 'utf8')), {
      id: process.env.STORE_BUILD_ID, platform: process.env.STORE_PLATFORM,
      revision: process.env.STORE_SOURCE_REVISION,
    });
    console.log(JSON.stringify(receipt));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
