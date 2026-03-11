const fs = require('fs');
const filename = 'ts_errors_2.txt';

try {
    const buffer = fs.readFileSync(filename);
    const content = buffer.toString('utf16le');
    const lines = content.split('\n');
    
    // Filter for common field name errors
    const patterns = ["'text'", "'user_id'", "'profile_id'", "'start_time'", "'end_time'"];
    
    const relevantErrors = lines.filter(line => 
        patterns.some(p => line.includes(p)) && 
        (line.includes('does not exist') || line.includes('is not assignable') || line.includes('is missing'))
    );
    
    console.log(`Found ${relevantErrors.length} schema-related errors:`);
    relevantErrors.slice(0, 20).forEach(err => console.log(err.trim()));
} catch (err) {
    console.error('Error:', err);
}
