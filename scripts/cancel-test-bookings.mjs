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

const fetchAll = async (table, select) => {
  const out = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
};

const profiles = await fetchAll('profiles', 'id, is_test_account');
const testIds = profiles.filter((p) => p.is_test_account).map((p) => p.id);

if (testIds.length === 0) {
  console.log('No test accounts found to cancel bookings for.');
  process.exit(0);
}

const bookings = await fetchAll('bookings', 'id, client_id, photographer_id, model_id, status');
const toCancel = bookings.filter((b) =>
  testIds.includes(b.client_id) ||
  (b.photographer_id && testIds.includes(b.photographer_id)) ||
  (b.model_id && testIds.includes(b.model_id))
);

if (toCancel.length === 0) {
  console.log('No bookings tied to test accounts.');
  process.exit(0);
}

const ids = toCancel.map((b) => b.id);
const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

let updated = 0;
for (const batch of chunk(ids, 100)) {
  const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).in('id', batch);
  if (error) {
    console.warn('Failed to cancel batch', error.message);
  } else {
    updated += batch.length;
  }
}

console.log(`Cancelled ${updated} bookings linked to test accounts.`);
