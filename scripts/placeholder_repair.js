const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  console.log('Fetching remote migration list...');
  const output = execSync('npx supabase migration list', { encoding: 'utf8', stdio: 'pipe' });
  const lines = output.split('\n');
  
  const toRevert = [];
  lines.forEach(line => {
    if (line.includes('|')) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 5) {
        const version = parts[1];
        const isRemote = parts[4] && parts[4].toLowerCase() === 'applied';
        if (isRemote && /^\d+$/.test(version)) {
          toRevert.push(version);
        }
      }
    }
  });

  if (toRevert.length > 0) {
    console.log(`Creating placeholders for ${toRevert.length} versions...`);
    const migDir = path.join(process.cwd(), 'supabase', 'migrations');
    if (!fs.existsSync(migDir)) fs.mkdirSync(migDir, { recursive: true });

    toRevert.forEach(v => {
      const p = path.join(migDir, `${v}_placeholder.sql`);
      if (!fs.existsSync(p)) fs.writeFileSync(p, '-- placeholder');
    });

    console.log('Reverting all remote markers...');
    for (let i = 0; i < toRevert.length; i += 10) {
      const batch = toRevert.slice(i, i + 10);
      try {
        execSync(`npx supabase migration repair --status reverted ${batch.join(' ')}`, { stdio: 'inherit' });
      } catch (e) {
        console.warn(`  Failed batch: ${batch.join(' ')}`);
      }
    }
  }

  console.log('History purged. Now creating Nuclear Reset migration...');
  const nuclearPath = path.join(process.cwd(), 'supabase', 'migrations', '20000101000000_nuclear_reset.sql');
  fs.writeFileSync(nuclearPath, `
begin;
do $$
begin
  execute 'drop schema if exists public cascade';
  execute 'create schema public';
  execute 'drop schema if exists supabase_migrations cascade';
  execute 'create extension if not exists pgcrypto';
end $$;
commit;
  `);

  console.log('Attempting Nuclear Push (requires interaction)...');
  // We can't easily pipe 'y' to npx supabase in some shells, so we just try.
} catch (err) {
  console.error('Error:', err.message);
}
