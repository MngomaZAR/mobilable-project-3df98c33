const { execSync } = require('child_process');

try {
  console.log('Fetching all migration markers from remote...');
  const output = execSync('npx supabase migration list', { encoding: 'utf8', stdio: 'pipe' });
  const lines = output.split('\n');
  
  const remoteAtRemoteOnly = [];
  lines.forEach(line => {
    if (line.includes('|')) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 5) {
        const version = parts[1];
        const isRemote = parts[4] && parts[4].toLowerCase() === 'applied';
        
        if (isRemote && /^\d+$/.test(version)) {
          remoteAtRemoteOnly.push(version);
        }
      }
    }
  });

  if (remoteAtRemoteOnly.length > 0) {
    console.log(`Reverting ${remoteAtRemoteOnly.length} remote markers:`, remoteAtRemoteOnly);
    // Batch and revert
    for (let i = 0; i < remoteAtRemoteOnly.length; i += 10) {
      const batch = remoteAtRemoteOnly.slice(i, i + 10);
      const cmd = `npx supabase migration repair --status reverted ${batch.join(' ')}`;
      console.log(`Running: ${cmd}`);
      execSync(cmd, { stdio: 'inherit' });
    }
  } else {
    console.log('No remote markers found.');
  }

  console.log('Remote history cleared. Now attempting db push (this will re-run all migrations)...');
  // Use --force to ensure we overwrite if needed, though 'reverted' should make push try everything.
  execSync('npx supabase db push --linked', { stdio: 'inherit' });
  console.log('SUCCESS: Database reset and re-baselined!');

} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
