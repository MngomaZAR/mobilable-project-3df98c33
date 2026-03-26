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
  .select('id, full_name')
  .in('full_name', named);

if (profilesError) {
  console.error('profiles error', profilesError.message);
  process.exit(1);
}

const profileIds = profiles.map((p) => p.id);
const { error: profileOnlineError } = await supabase
  .from('profiles')
  .update({ availability_status: 'online' })
  .in('id', profileIds);
if (profileOnlineError) {
  console.warn('profile availability update failed', profileOnlineError.message);
}

const { data: photographers, error: photographersError } = await supabase
  .from('photographers')
  .select('id, latitude, longitude')
  .in('id', profileIds);

if (photographersError) {
  console.error('photographers error', photographersError.message);
  process.exit(1);
}

const durbanPhotographers = photographers.filter(
  (p) => p.latitude !== null && p.latitude >= -30.5 && p.latitude <= -29.0
);

if (durbanPhotographers.length > 0) {
  const { error: onlineError } = await supabase
    .from('photographers')
    .update({ is_online: true })
    .in('id', durbanPhotographers.map((p) => p.id));
  if (onlineError) {
    console.warn('photographers online update failed', onlineError.message);
  }
}

// Update "Your bookings" status + pricing knobs (price recalculated by trigger)
const { data: yourBookingsUpdate, error: yourBookingsError } = await supabase
  .from('bookings')
  .update({ status: 'accepted', photo_count: 277, distance_km: 0 })
  .eq('package_type', 'Your bookings')
  .not('start_datetime', 'is', null)
  .select('id, price_total, total_amount, status');
if (yourBookingsError) {
  console.warn('your bookings update failed', yourBookingsError.message);
} else {
  console.log('your bookings updated', yourBookingsUpdate);
}

// Update Half-day coverage prices for Sipho Durban bookings
const siphoDurbanIds = durbanPhotographers
  .filter((p) => profiles.find((pr) => pr.id === p.id)?.full_name === 'Sipho Dlamini')
  .map((p) => p.id);

if (siphoDurbanIds.length > 0) {
  const { data: halfDayUpdate, error: halfDayError } = await supabase
    .from('bookings')
    .update({ photo_count: 277, distance_km: 0 })
    .eq('package_type', 'Half-day coverage')
    .not('start_datetime', 'is', null)
    .in('photographer_id', siphoDurbanIds)
    .select('id, price_total, total_amount, status');
  if (halfDayError) {
    console.warn('half-day update failed', halfDayError.message);
  } else {
    console.log('half-day updated', halfDayUpdate?.length ?? 0);
  }
}

// Seed tip goal for demo creator if missing
const seedCreatorId = siphoDurbanIds[0] ?? profileIds[0];
if (seedCreatorId) {
  const { data: existingGoal } = await supabase
    .from('tip_goals')
    .select('id')
    .eq('creator_id', seedCreatorId)
    .limit(1);
  if (!existingGoal || existingGoal.length === 0) {
    const { error: tipError } = await supabase.from('tip_goals').insert({
      creator_id: seedCreatorId,
      title: 'New lens fund',
      target_amount: 5000,
      is_active: true,
    });
    if (tipError) {
      console.warn('tip goals insert failed', tipError.message);
    }
  }

  const { data: existingPayout } = await supabase
    .from('payout_methods')
    .select('id')
    .eq('user_id', seedCreatorId)
    .limit(1);
  if (!existingPayout || existingPayout.length === 0) {
    const { error: payoutError } = await supabase.from('payout_methods').insert({
      user_id: seedCreatorId,
      bank_name: 'Demo Bank',
      account_holder: 'Papzi Creator',
      account_number: '0001234567',
      account_type: 'cheque',
      branch_code: '000123',
      is_default: true,
      verified: true,
    });
    if (payoutError) {
      console.warn('payout methods insert failed', payoutError.message);
    }
  }
}

// Handle JHB Sipho duplicate safely
const siphoProfiles = profiles.filter((p) => p.full_name === 'Sipho Dlamini');
for (const sipho of siphoProfiles) {
  const photographer = photographers.find((p) => p.id === sipho.id);
  if (!photographer) continue;
  if (photographer.latitude !== null && photographer.latitude > -29) {
    const { data: siphoBookings } = await supabase
      .from('bookings')
      .select('id')
      .eq('photographer_id', sipho.id)
      .limit(1);

    if (!siphoBookings || siphoBookings.length === 0) {
      await supabase.from('photographers').delete().eq('id', sipho.id);
    } else {
      await supabase
        .from('profiles')
        .update({ full_name: 'Sipho Dlamini (JHB)', availability_status: 'offline' })
        .eq('id', sipho.id);
      await supabase.from('photographers').update({ is_online: false }).eq('id', sipho.id);
    }
  }
}

console.log('Launch audit v2 data updates complete.');
