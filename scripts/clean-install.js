const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// Remove node_modules
const nm = path.join(root, 'node_modules');
if (fs.existsSync(nm)) {
  console.log('Removing node_modules...');
  fs.rmSync(nm, { recursive: true, force: true });
  console.log('Removed node_modules.');
} else {
  console.log('No node_modules found.');
}

// Remove package-lock.json
const lock = path.join(root, 'package-lock.json');
if (fs.existsSync(lock)) {
  console.log('Removing package-lock.json...');
  fs.unlinkSync(lock);
  console.log('Removed package-lock.json.');
} else {
  console.log('No package-lock.json found.');
}

// Run npm install
console.log('Running npm install --legacy-peer-deps...');
try {
  const result = execSync('npm install --legacy-peer-deps', {
    cwd: root,
    stdio: 'pipe',
    timeout: 120000,
  });
  console.log(result.toString());
  console.log('npm install completed successfully!');
} catch (err) {
  console.error('npm install failed:');
  console.error(err.stderr ? err.stderr.toString() : err.message);
  process.exit(1);
}
