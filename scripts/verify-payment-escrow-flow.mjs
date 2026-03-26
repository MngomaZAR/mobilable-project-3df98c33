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
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const clientEmail = process.env.TEST_LOGIN_EMAIL;
const clientPassword = process.env.TEST_LOGIN_PASSWORD;
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!url || !anonKey || !serviceKey) {
  console.error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!clientEmail || !clientPassword) {
  console.error('Missing TEST_LOGIN_EMAIL or TEST_LOGIN_PASSWORD in environment.');
  process.exit(1);
}
if (!adminEmail || !adminPassword) {
  console.error('Missing ADMIN_EMAIL or ADMIN_PASSWORD in environment.');
  process.exit(1);
}

const client = createClient(url, anonKey, { auth: { persistSession: false } });
const adminAuth = createClient(url, anonKey, { auth: { persistSession: false } });
const service = createClient(url, serviceKey, { auth: { persistSession: false } });

const log = (label, value) => console.log(`${label}:`, value);

// 1. Sign in as client
const { data: clientSession, error: clientError } = await client.auth.signInWithPassword({
  email: clientEmail,
  password: clientPassword,
});
if (clientError || !clientSession?.session) {
  console.error('Client login failed:', clientError?.message ?? 'No session');
  process.exit(1);
}
log('Client login ok', clientSession.user?.id);

// 2. Pick a live photographer (Sipho Dlamini in Durban)
const { data: siphoProfile } = await service
  .from('profiles')
  .select('id, full_name')
  .eq('full_name', 'Sipho Dlamini')
  .limit(1)
  .maybeSingle();

if (!siphoProfile?.id) {
  console.error('No Sipho Dlamini profile found. Seed demo profiles first.');
  process.exit(1);
}

// 3. Create booking as client
const bookingInsert = await client
  .from('bookings')
  .insert({
    client_id: clientSession.user.id,
    photographer_id: siphoProfile.id,
    status: 'pending',
    package_type: 'Payment QA booking',
    booking_date: new Date().toISOString(),
    price_total: 3600,
    base_amount: 3600,
    travel_amount: 0,
    notes: 'QA payment flow verification',
  })
  .select('id')
  .maybeSingle();

if (bookingInsert.error || !bookingInsert.data?.id) {
  console.error('Booking insert failed:', bookingInsert.error?.message ?? 'No booking created');
  process.exit(1);
}

const bookingId = bookingInsert.data.id;
log('Booking created', bookingId);

// 4. Ensure payment row exists with intended amount before PayFast signing
const { data: existingPayment } = await service
  .from('payments')
  .select('id, amount')
  .eq('booking_id', bookingId)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (!existingPayment?.id) {
  const { error: createPaymentErr } = await service.from('payments').insert({
    booking_id: bookingId,
    customer_id: clientSession.user.id,
    description: 'Payment QA booking',
    amount: 3600,
    currency: 'ZAR',
    provider: 'payfast',
    status: 'pending',
  });
  if (createPaymentErr) {
    console.error('Payment row create failed:', createPaymentErr.message);
    process.exit(1);
  }
}

// 5. Create PayFast checkout link (verifies PayFast config + payment row)
const checkoutRes = await client.functions.invoke('payfast-handler', {
  body: { booking_id: bookingId, return_url: `${url}/payfast/return`, cancel_url: `${url}/payfast/cancel` },
});

if (checkoutRes.error) {
  console.error('Payfast handler error:', checkoutRes.error.message);
  process.exit(1);
}
log('Payfast checkout ok', checkoutRes.data?.paymentId ?? checkoutRes.data?.payment_id ?? 'unknown');

// 6. Simulate payment completion by updating payment + booking
const { data: paymentRow } = await service
  .from('payments')
  .select('id, status')
  .eq('booking_id', bookingId)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (!paymentRow?.id) {
  console.error('Payment row not found for booking.');
  process.exit(1);
}

await service.from('payments').update({ status: 'completed' }).eq('id', paymentRow.id);
await service.from('bookings').update({ status: 'completed' }).eq('id', bookingId);

log('Payment marked completed', paymentRow.id);

// 7. Sign in as admin to release escrow
const { data: adminSession, error: adminError } = await adminAuth.auth.signInWithPassword({
  email: adminEmail,
  password: adminPassword,
});
if (adminError || !adminSession?.session) {
  console.error('Admin login failed:', adminError?.message ?? 'No session');
  process.exit(1);
}

const escrowRes = await adminAuth.functions.invoke('escrow-release', { body: { booking_id: bookingId } });
if (escrowRes.error) {
  console.error('Escrow release error:', escrowRes.error.message);
  process.exit(1);
}
log('Escrow release response', escrowRes.data);

// 8. Verify booking paid_out + earnings created
const { data: bookingAfter } = await service
  .from('bookings')
  .select('id, status')
  .eq('id', bookingId)
  .maybeSingle();
const { data: earnings } = await service
  .from('earnings')
  .select('id, amount, source_id')
  .eq('source_id', bookingId);

log('Booking status', bookingAfter?.status);
log('Earnings rows', earnings?.length ?? 0);

console.log('Payment + escrow verification complete.');
