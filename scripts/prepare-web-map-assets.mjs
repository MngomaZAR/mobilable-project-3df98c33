import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(path.dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const destination = path.join(root, 'public', 'maplibre');

mkdirSync(destination, { recursive: true });
// The module worker imports its shared sibling by relative URL.
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(path.join(source, file), path.join(destination, file));
}
console.log(`Prepared MapLibre ${require('maplibre-gl/package.json').version} web worker assets.`);
