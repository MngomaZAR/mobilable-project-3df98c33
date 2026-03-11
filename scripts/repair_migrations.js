const { execSync } = require('child_process');

try {
  console.log('Fetching migration list...');
  const output = execSync('npx supabase migration list', { encoding: 'utf8' });
  const lines = output.split('\n');
  
  const remoteAtRemoteOnly = [];
  lines.forEach(line => {
    if (line.includes('|')) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 4) {
        const version = parts[1];
        // In the list view: | Version | Name | Local | Remote |
        // Remote is parts[4], Local is parts[3]
        const isLocal = parts[3] && parts[3].toLowerCase() !== '';
        const isRemote = parts[4] && parts[4].toLowerCase() !== '';
        
        if (isRemote && !isLocal && /^\d+$/.test(version)) {
          remoteAtRemoteOnly.push(version);
        }
      }
    }
  });

  if (remoteAtRemoteOnly.length > 0) {
    console.log(`Found ${remoteAtRemoteOnly.length} remote-only migrations:`, remoteAtRemoteOnly);
    // Batching to avoid command line length limits
    const cmd = `npx supabase migration repair --status reverted ${remoteAtRemoteOnly.join(' ')}`;
    console.log('Running repair command...');
    execSync(cmd, { stdio: 'inherit' });
    console.log('Done.');
  } else {
    console.log('No remote-only migrations found.');
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
