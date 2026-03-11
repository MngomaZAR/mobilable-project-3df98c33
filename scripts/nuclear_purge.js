const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  console.log('Fetching migration list with debug logging...');
  const output = execSync('npx supabase migration list', { encoding: 'utf8', stdio: 'pipe' });
  console.log('--- OUTPUT START ---');
  console.log(output);
  console.log('--- OUTPUT END ---');
  
  const lines = output.split('\n');
  const versions = [];
  
  // Looking for any sequence of digits that looks like a version in the table rows
  lines.forEach(line => {
    // Match 8-14 digit numbers followed by a pipe or whitespace in a table context
    const matches = line.match(/^\s*│?\s*(\d{8,14})\s*│/);
    if (matches) {
      versions.push(matches[1]);
    } else {
        // Fallback for different table styles
        const matches2 = line.match(/\|\s*(\d{8,14})\s*\|/);
        if (matches2) versions.push(matches2[1]);
    }
  });

  // Unique versions only
  const uniqueVersions = [...new Set(versions)];

  if (uniqueVersions.length > 0) {
    console.log(`Found ${uniqueVersions.length} versions to purge:`, uniqueVersions);
    
    uniqueVersions.forEach(v => {
      console.log(`Purging ${v}...`);
      try {
        // We create a dummy file just in case the CLI requires it for revert (some versions do)
        const dummyPath = path.join(process.cwd(), 'supabase', 'migrations', `${v}_ghost.sql`);
        if (!fs.existsSync(dummyPath)) fs.writeFileSync(dummyPath, '-- ghost purge');
        
        execSync(`npx supabase migration repair --status reverted ${v}`, { stdio: 'inherit' });
        
        // Clean up dummy
        if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
      } catch (e) {
        console.warn(`  Failed to purge ${v}.`);
      }
    });

    console.log('History purged. Folder cleaned.');
  } else {
    console.log('No versions found via regex parsing.');
  }

} catch (err) {
  console.error('Fatal Error:', err.message);
}
