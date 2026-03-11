const { execSync } = require('child_process');

// Versions we've identified from logs and file list
const versions = [
  '20240624',
  '20240720',
  '20241005',
  '20241020',
  '20260106114637',
  '20260203000000',
  '20260203000001',
  '20260203', // This one might be the short version seen in logs
  '20260204',
  '20260306030000',
  '20260307120000',
  '20260307130000',
  '20260307140000',
  '20260307160000'
];

versions.forEach(v => {
  try {
    console.log(`Reverting remote marker for version: ${v}...`);
    execSync(`npx supabase migration repair --status reverted ${v}`, { stdio: 'pipe' });
  } catch (err) {
    if (err.stdout && err.stdout.includes('reverted')) {
        console.log(`  Success (via stdout).`);
    } else {
        console.warn(`  Failed or version not found (Status: Reverted/Missing).`);
    }
  }
});

console.log('\nPurge complete. Moving migrations back and attempting db push...');
try {
    execSync('Move-Item supabase/migrations_old/* supabase/migrations/ -Force', { shell: 'powershell', stdio: 'inherit' });
    execSync('npx supabase db push --linked', { stdio: 'inherit' });
    console.log('FINAL SUCCESS: Schema pushed!');
} catch (err) {
    console.error('Final push failed. CLI output will show remaining blockers.');
}
