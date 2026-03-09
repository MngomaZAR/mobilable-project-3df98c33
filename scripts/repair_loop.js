const { execSync } = require('child_process');

function runRepair() {
  let attempts = 0;
  const maxAttempts = 20;
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`\n--- Attempt ${attempts} ---`);
    try {
      console.log('Trying npx supabase db push...');
      // Use a custom capture because db push produces stderr/stdout
      execSync('npx supabase db push --linked', { stdio: 'pipe', encoding: 'utf8' });
      console.log('SUCCESS: Migration pushed!');
      return;
    } catch (err) {
      const output = err.stdout + '\n' + err.stderr;
      console.log('Caught error. Checking for missing remote versions...');
      
      // Look for: Remote migration versions not found in local migrations directory: 20240624, 20240720...
      const match = output.match(/Remote migration versions not found in local migrations directory: ([\d, ]+)/);
      if (match) {
        const versions = match[1].split(',').map(v => v.trim()).filter(v => v);
        console.log(`Found missing remote versions: ${versions.join(', ')}`);
        
        const repairCmd = `npx supabase migration repair --status reverted ${versions.join(' ')}`;
        console.log(`Running: ${repairCmd}`);
        try {
          execSync(repairCmd, { stdio: 'inherit' });
          console.log('Repair successful. Retrying push...');
        } catch (repairErr) {
          console.error('Repair command failed. Trying one by one...');
          for (const v of versions) {
            try {
              execSync(`npx supabase migration repair --status reverted ${v}`, { stdio: 'inherit' });
            } catch(e) { /* ignore individual failures */ }
          }
        }
      } else {
        console.log('Unknown error during push. Output snippet:');
        console.log(output.slice(-500));
        return;
      }
    }
  }
}

runRepair();
