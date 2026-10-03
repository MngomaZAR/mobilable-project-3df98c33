import fs from 'node:fs';

const sql = fs.readFileSync('backend/api/migrations/202610030001_launch_foundation.sql', 'utf8');
const contract = JSON.parse(fs.readFileSync('backend/api/app/mobile_schema_contract.json', 'utf8'));
const columns = new Map();
for (const match of sql.matchAll(/ALTER TABLE "?(\w+)"? ADD COLUMN IF NOT EXISTS "?(\w+)"?/g)) {
  if (!columns.has(match[1])) columns.set(match[1], new Set(['id', 'created_at', 'updated_at']));
  columns.get(match[1]).add(match[2]);
}
const missing = Object.fromEntries(Object.entries(contract).map(([table, required]) => [table, required.filter(column => !columns.get(table)?.has(column))]).filter(([, fields]) => fields.length));
console.log(JSON.stringify(missing, null, 2));
