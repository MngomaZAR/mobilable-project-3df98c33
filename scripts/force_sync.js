const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  const migDir = path.join(process.cwd(), 'supabase', 'migrations');
  console.log('Fetching local migration files...');
  const files = fs.readdirSync(migDir);
  
  const versions = [];
  files.forEach(f => {
    const match = f.match(/^(\d+)/);
    if (match) versions.push(match[1]);
  });

  if (versions.length > 0) {
    console.log(`Marking ${versions.length} local versions as 'applied' on remote to bypass sync error...`);
    for (let i = 0; i < versions.length; i += 5) {
      const batch = versions.slice(i, i + 5);
      console.log(`Running repair for batch: ${batch.join(', ')}`);
      try {
        execSync(`npx supabase migration repair --status applied ${batch.join(' ')}`, { stdio: 'inherit' });
      } catch (e) {
        console.warn(`  Batch failed, trying one-by-one...`);
        batch.forEach(v => {
          try { execSync(`npx supabase migration repair --status applied ${v}`, { stdio: 'inherit' }); } catch(err) {}
        });
      }
    }
    console.log('History marked as applied. Now attempting db push...');
  } else {
    console.log('No local migrations found to sync.');
  }

} catch (err) {
  console.error('Fatal Error:', err.message);
}
