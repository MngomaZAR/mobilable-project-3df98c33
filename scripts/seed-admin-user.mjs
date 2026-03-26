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
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!adminEmail) {
  console.error('Missing ADMIN_EMAIL in environment.');
  process.exit(1);
}
if (!adminPassword) {
  console.error('Missing ADMIN_PASSWORD in environment.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const findUserByEmail = async (email) => {
  if (supabase.auth?.admin?.getUserByEmail) {
    const { data, error } = await supabase.auth.admin.getUserByEmail(email);
    if (error) return null;
    return data?.user ?? null;
  }

  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const users = data?.users ?? [];
    const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
};

let user = await findUserByEmail(adminEmail);
if (!user) {
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: adminEmail.split('@')[0] },
  });
  if (createError) {
    console.error('Failed to create admin user:', createError.message);
    process.exit(1);
  }
  user = created?.user ?? null;
}

if (!user) {
  console.error(`Unable to create or fetch auth user for ${adminEmail}`);
  process.exit(1);
}

const fullName = user.user_metadata?.full_name || adminEmail.split('@')[0];

const { error: upsertError } = await supabase.from('profiles').upsert({
  id: user.id,
  full_name: fullName,
  role: 'admin',
  verified: true,
  kyc_status: 'approved',
  availability_status: 'online',
});

if (upsertError) {
  console.error('Failed to promote admin:', upsertError.message);
  process.exit(1);
}

console.log(`Admin profile seeded for ${adminEmail} (id: ${user.id}).`);
