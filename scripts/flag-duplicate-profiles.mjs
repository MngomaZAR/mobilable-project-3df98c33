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

const profiles = await fetchAll('profiles', 'id, full_name, role, created_at, avatar_url, availability_status, is_test_account');
const photographerRows = await fetchAll('photographers', 'id');
const modelRows = await fetchAll('models', 'id');

const photographerIds = new Set(photographerRows.map((p) => p.id));
const modelIds = new Set(modelRows.map((m) => m.id));

const grouped = new Map();
for (const profile of profiles) {
  const name = (profile.full_name ?? '').trim();
  if (!name) continue;
  const keyName = name.toLowerCase();
  if (!grouped.has(keyName)) grouped.set(keyName, []);
  grouped.get(keyName).push(profile);
}

const idsToFlag = [];
const summary = [];

for (const [name, group] of grouped.entries()) {
  if (group.length < 2) continue;
  const photographerGroup = group.filter((p) => photographerIds.has(p.id));
  const modelGroup = group.filter((p) => modelIds.has(p.id));
  let keep = null;
  if (photographerGroup.length > 0) {
    keep = photographerGroup.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  } else if (modelGroup.length > 0) {
    keep = modelGroup.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  } else {
    keep = group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  }

  const toFlag = group.filter((p) => p.id !== keep.id);
  if (toFlag.length > 0) {
    summary.push({ name, keep: keep.id, flagged: toFlag.map((p) => p.id) });
    for (const prof of toFlag) {
      if (!prof.is_test_account) idsToFlag.push(prof.id);
    }
  }
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

for (const batch of chunk(idsToFlag, 100)) {
  const { error } = await supabase.from('profiles').update({ is_test_account: true }).in('id', batch);
  if (error) {
    console.warn('Failed to flag batch', error.message);
  }
}

console.log(`Duplicate groups found: ${summary.length}`);
console.log(`Profiles flagged: ${idsToFlag.length}`);
if (summary.length > 0) {
  console.log('Sample:', summary.slice(0, 5));
}
