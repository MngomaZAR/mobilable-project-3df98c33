import { execSync } from 'child_process';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';

const root = join(import.meta.dirname, '..');

// Remove node_modules
const nm = join(root, 'node_modules');
if (existsSync(nm)) {
  console.log('Removing node_modules...');
  rmSync(nm, { recursive: true, force: true });
  console.log('Removed node_modules.');
} else {
  console.log('No node_modules found.');
}

// Remove package-lock.json
const lock = join(root, 'package-lock.json');
if (existsSync(lock)) {
  console.log('Removing package-lock.json...');
  rmSync(lock, { force: true });
  console.log('Removed package-lock.json.');
} else {
  console.log('No package-lock.json found.');
}

// Run npm install
console.log('Running npm install --legacy-peer-deps...');
try {
  execSync('npm install --legacy-peer-deps', { cwd: root, stdio: 'inherit' });
  console.log('npm install completed successfully!');
} catch (err) {
  console.error('npm install failed:', err.message);
  process.exit(1);
}
