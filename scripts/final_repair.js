const { execSync } = require('child_process');

try {
  console.log('Fetching full migration list...');
  const output = execSync('npx supabase migration list', { encoding: 'utf8', stdio: 'pipe' });
  const lines = output.split('\n');
  
  const versionsToRevert = [];
  lines.forEach(line => {
    if (line.includes('|')) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 4) {
        const version = parts[1];
        const isLocal = parts[3] && parts[3].toLowerCase() !== '';
        const isRemote = parts[4] && parts[4].toLowerCase() !== '';
        
        // If it's on remote but NOT local, we REVERT it in the metadata table
        if (isRemote && !isLocal && /^\d+$/.test(version)) {
          versionsToRevert.push(version);
        }
      }
    }
  });

  if (versionsToRevert.length > 0) {
    console.log(`Reverting ${versionsToRevert.length} remote-only versions...`);
    // Run in batches of 5 to avoid command line length issues and see progress
    for (let i = 0; i < versionsToRevert.length; i += 5) {
      const batch = versionsToRevert.slice(i, i + 5);
      const cmd = `npx supabase migration repair --status reverted ${batch.join(' ')}`;
      console.log(`Running: ${cmd}`);
      try {
        execSync(cmd, { stdio: 'inherit' });
      } catch (e) {
        console.error(`Failed to revert batch: ${batch}`);
      }
    }
    console.log('History repair complete.');
  } else {
    console.log('No remote-only versions found to revert.');
  }

  // Now try the push
  console.log('Attempting final db push...');
  execSync('npx supabase db push --linked', { stdio: 'inherit' });
  console.log('SUCCESS!');

} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
