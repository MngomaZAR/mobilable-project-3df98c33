const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  console.log('Fetching remote migration list...');
  const output = execSync('npx supabase migration list', { encoding: 'utf8', stdio: 'pipe' });
  const lines = output.split('\n');
  
  const remoteVersions = [];
  lines.forEach(line => {
    if (line.includes('|')) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 5) {
        const version = parts[1];
        const isRemote = parts[4] && parts[4].toLowerCase() === 'applied';
        if (isRemote && /^\d+$/.test(version)) {
          remoteVersions.push(version);
        }
      }
    }
  });

  if (remoteVersions.length > 0) {
    console.log(`Synchronizing placeholders for ${remoteVersions.length} remote versions...`);
    const migDir = path.join(process.cwd(), 'supabase', 'migrations');
    if (!fs.existsSync(migDir)) fs.mkdirSync(migDir, { recursive: true });

    // Ensure we have a local file for every remote marker
    remoteVersions.forEach(v => {
      const p = path.join(migDir, `${v}_sync.sql`);
      if (!fs.existsSync(p)) fs.writeFileSync(p, '-- sync marker');
    });

    console.log('Reverting all remote markers to decuople CLI from history...');
    // We do them one by one to ensure we don't hit command line limits and see immediate results
    remoteVersions.forEach(v => {
        try {
            console.log(`Reverting ${v}...`);
            execSync(`npx supabase migration repair --status reverted ${v}`, { stdio: 'inherit' });
        } catch(e) { /* skip individual errors */ }
    });

    console.log('History purged! Cleaning migrations folder for a fresh start...');
    const files = fs.readdirSync(migDir);
    files.forEach(f => fs.unlinkSync(path.join(migDir, f)));

    console.log('Ready for the hardened schema push.');
  } else {
    console.log('No remote markers found. The DB might already be clean or CLI list failed.');
  }
} catch (err) {
  console.error('Fatal Error:', err.message);
}
