import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('all EAS entry points use the pinned CLI version from eas.json', async () => {
  const eas = JSON.parse(await readFile(path.join(root, 'eas.json'), 'utf8'));
  const version = eas.cli?.version;
  assert.match(version, /^\d+\.\d+\.\d+$/);

  const files = [
    ...['.github/workflows', 'scripts'].flatMap((directory) =>
      directory === '.github/workflows'
        ? ['eas-build-android.yml', 'eas-build-internal-qa.yml', 'eas-build-ios.yml',
          'eas-deploy-web.yml', 'eas-submit-android.yml', 'eas-submit-ios.yml',
          'ios-testflight-no-eas.yml'].map((file) => path.join(root, directory, file))
        : [path.join(root, directory, 'submit-store.mjs')]
    ),
  ];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/eas-version:\s*([^\s]+)/g)) {
      assert.equal(match[1], version, `${path.relative(root, file)} has a mismatched eas-version`);
    }
    for (const match of source.matchAll(/eas-cli@([^\s'"`]+)/g)) {
      assert.equal(match[1], version, `${path.relative(root, file)} has a mismatched eas-cli version`);
    }
  }
});
