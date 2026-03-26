import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.join(process.cwd(), '.env.local');
const envText = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx).trim();
  const value = trimmed.slice(idx + 1).trim();
  env[key] = value;
}

const url = env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const named = [
  'Michael Scott',
  'Anna Gomez',
  'Jason Lee',
  'Olivia Harris',
  'Lerato Sithole',
  'Sipho Dlamini',
];

const { data: profiles, error: profilesError } = await supabase
  .from('profiles')
  .select('id, full_name, availability_status')
  .in('full_name', named);

if (profilesError) {
  console.error('profiles error', profilesError.message);
  process.exit(1);
}

const profileIds = profiles.map((p) => p.id);
const { data: photographers, error: photographersError } = await supabase
  .from('photographers')
  .select('id, is_online, latitude, longitude, hourly_rate, rating')
  .in('id', profileIds);

if (photographersError) {
  console.error('photographers error', photographersError.message);
  process.exit(1);
}

const { data: bookings, error: bookingsError } = await supabase
  .from('bookings')
  .select('id, package_type, status, price_total, start_datetime, photographer_id')
  .in('package_type', ['Your bookings', 'Half-day coverage']);

if (bookingsError) {
  console.error('bookings error', bookingsError.message);
  process.exit(1);
}

// If pg_catalog access is blocked, we fall back to a lightweight query.
let realtimeTables = [];
try {
  const { data } = await supabase
    .from('pg_publication_tables')
    .select('pubname, schemaname, tablename')
    .eq('pubname', 'supabase_realtime');
  realtimeTables = data ?? [];
} catch {
  realtimeTables = [];
}

const { data: tipGoals, error: tipGoalsError } = await supabase.from('tip_goals').select('*').limit(1);
const { data: payoutMethods } = await supabase.from('payout_methods').select('id').limit(5);

console.log('Profiles:', profiles);
console.log('Photographers:', photographers);
console.log('Bookings:', bookings);
if (tipGoalsError) {
  console.log('Tip goals error:', tipGoalsError.message);
} else {
  console.log('Tip goals count:', tipGoals?.length ?? 0);
  if (tipGoals && tipGoals.length > 0) {
    console.log('Tip goals sample keys:', Object.keys(tipGoals[0]));
  }
}
console.log('Payout methods count:', payoutMethods?.length ?? 0);
if (realtimeTables.length > 0) {
  console.log('Realtime tables:', realtimeTables.map((t) => t.tablename));
} else {
  console.log('Realtime tables: unavailable (no access)');
}
