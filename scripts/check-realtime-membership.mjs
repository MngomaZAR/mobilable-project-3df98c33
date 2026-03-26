import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const envPath = path.join(process.cwd(), '.env.local');
const env = {};
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }
}

const merged = { ...env, ...process.env };
let dbUrl = merged.SUPABASE_DB_URL;
if (!dbUrl && merged.SUPABASE_DB_PASSWORD && merged.SUPABASE_URL) {
  const projectRef = merged.SUPABASE_URL.replace('https://', '').split('.')[0];
  const user = `postgres.${projectRef}`;
  const host = 'aws-1-eu-west-1.pooler.supabase.com';
  dbUrl = `postgresql://${user}:${merged.SUPABASE_DB_PASSWORD}@${host}:5432/postgres`;
}

if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL or SUPABASE_DB_PASSWORD + SUPABASE_URL');
  process.exit(1);
}

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const res = await client.query(
    "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename;"
  );
  console.log('Realtime tables:', res.rows.map((r) => r.tablename));
} finally {
  await client.end();
}
