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
const anonKey = env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.TEST_LOGIN_EMAIL;
const password = process.env.TEST_LOGIN_PASSWORD;

if (!url || !anonKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}
if (!email || !password) {
  console.error('Missing TEST_LOGIN_EMAIL or TEST_LOGIN_PASSWORD in environment.');
  process.exit(1);
}

const supabase = createClient(url, anonKey, { auth: { persistSession: false } });

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (authError || !authData?.session) {
  console.error('Login failed:', authError?.message ?? 'No session');
  process.exit(1);
}

console.log('Login ok:', authData.user?.id);

// Payout methods flow
const listBefore = await supabase.functions.invoke('payout-methods', { body: { action: 'list' } });
if (listBefore.error) {
  console.warn('Payout list error:', listBefore.error.message);
} else {
  console.log('Payout methods before:', listBefore.data?.methods?.length ?? 0);
}

if ((listBefore.data?.methods ?? []).length === 0) {
  const addRes = await supabase.functions.invoke('payout-methods', {
    body: {
      action: 'add',
      bank_name: 'FNB',
      account_holder: 'Sam Mngoma',
      account_number: '1234567890',
      account_type: 'cheque',
      branch_code: '250655',
    },
  });
  if (addRes.error) {
    console.warn('Payout add error:', addRes.error.message);
  } else {
    console.log('Payout method added.');
  }
}

const listAfter = await supabase.functions.invoke('payout-methods', { body: { action: 'list' } });
if (listAfter.error) {
  console.warn('Payout list error:', listAfter.error.message);
} else {
  console.log('Payout methods after:', listAfter.data?.methods?.length ?? 0);
}

// KYC document insert (best-effort)
const kycPayloads = [
  { doc_type: 'passport', document_type: 'passport' },
  { doc_type: 'id_card', document_type: 'id_card' },
  { doc_type: 'driver_license', document_type: 'driver_license' },
  { doc_type: 'national_id', document_type: 'national_id' },
  { doc_type: 'proof_of_address', document_type: 'proof_of_address' },
];

let kycInserted = false;
for (const payload of kycPayloads) {
  const { error } = await supabase.from('kyc_documents').insert({
    user_id: authData.user.id,
    status: 'pending',
    file_url: 'https://example.com/kyc/sample.png',
    storage_path: 'kyc/sample.png',
    ...payload,
  });
  if (!error) {
    kycInserted = true;
    console.log('KYC document inserted with type:', payload.doc_type);
    break;
  }
}

if (!kycInserted) {
  console.warn('KYC insert failed for all document types (may require admin insert).');
}

await supabase.auth.signOut();
console.log('Done.');
