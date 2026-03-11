const fs = require('fs');
const filename = process.argv[2] || 'ts_errors.txt';

try {
    const buffer = fs.readFileSync(filename);
    const content = buffer.toString('utf16le');
    console.log(content);
} catch (err) {
    console.error('Error reading file:', err);
}
