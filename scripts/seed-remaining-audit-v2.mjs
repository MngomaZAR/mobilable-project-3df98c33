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

const showcaseCounts = [
  { name: 'Olivia Harris', review_count: 721, total_bookings: 324 },
  { name: 'Michael Scott', review_count: 287, total_bookings: 206 },
  { name: 'Anna Gomez', review_count: 319, total_bookings: 319 },
  { name: 'Jason Lee', review_count: 728, total_bookings: 203 },
];

const { data: profiles, error: profilesError } = await supabase
  .from('profiles')
  .select('id, full_name, role')
  .in('full_name', showcaseCounts.map((s) => s.name));

if (profilesError) {
  console.error('profiles fetch error', profilesError.message);
  process.exit(1);
}

const profileMap = new Map(profiles.map((p) => [p.full_name, p.id]));

for (const entry of showcaseCounts) {
  const id = profileMap.get(entry.name);
  if (!id) continue;
  const { error } = await supabase
    .from('photographers')
    .update({ review_count: entry.review_count, total_bookings: entry.total_bookings })
    .eq('id', id);
  if (error) {
    console.warn('review/booking count update failed', entry.name, error.message);
  }
}

// Insert a few review rows for visibility (best-effort)
const { data: bookingRows } = await supabase
  .from('bookings')
  .select('id, photographer_id, client_id')
  .not('start_datetime', 'is', null)
  .limit(8);

if (bookingRows && bookingRows.length > 0) {
  const sample = bookingRows.slice(0, 4).map((b, idx) => ({
    booking_id: b.id,
    photographer_id: b.photographer_id,
    client_id: b.client_id,
    rating: 5 - (idx % 2),
    comment: 'Great session.',
    moderation_status: 'approved',
  }));
  const { error: reviewError } = await supabase.from('reviews').insert(sample);
  if (reviewError) {
    console.warn('review insert failed', reviewError.message);
  }
}

// Seed a demo kyc document (best-effort)
const demoKycUserId = profileMap.get('Michael Scott') ?? profileMap.get('Anna Gomez');
if (demoKycUserId) {
  const { data: existingKyc } = await supabase
    .from('kyc_documents')
    .select('id')
    .eq('user_id', demoKycUserId)
    .limit(1);

  if (!existingKyc || existingKyc.length === 0) {
    const docTypes = [
      'passport',
      'id_card',
      'driver_license',
      'national_id',
      'selfie',
      'proof_of_address',
      'id',
    ];
    let inserted = false;
    for (const docType of docTypes) {
      const { error: kycError } = await supabase.from('kyc_documents').insert({
        user_id: demoKycUserId,
        doc_type: docType,
        document_type: docType,
        status: 'approved',
        file_url: 'https://example.com/kyc/demo-id.png',
        storage_path: 'kyc/demo-id.png',
      });
      if (!kycError) {
        inserted = true;
        break;
      }
      if (!/doc_type/i.test(kycError.message ?? '')) {
        console.warn('kyc insert failed', kycError.message);
        break;
      }
    }
    if (!inserted) {
      console.warn('kyc insert failed: doc_type constraint rejected all candidates');
    }
  }
}

// Flag E2E test accounts
const testNames = [
  'E2E photographer','E2E client','Smoke Provider','Smoke Client',
  'Lock Photographer','Lock Client','Lock2 Client','Chat Fix F',
  'Dispatch Pro B','Manual Client','Cap Client','Web Role photographer',
];
const { error: testError } = await supabase
  .from('profiles')
  .update({ is_test_account: true })
  .in('full_name', testNames);

if (testError) {
  console.warn('test account flagging failed', testError.message);
}

console.log('Remaining audit seeds applied (best-effort).');
