import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

function loadLocalEnv() {
  const files = ['.env.local', '.env'];
  for (const name of files) {
    const abs = path.join(process.cwd(), name);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).replace(/^\uFEFF/, '').trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadLocalEnv();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const REFERENCE_CLIENT = {
  id: '5b2f56b4-1a3b-4c9c-a9c3-7c9b8b1c2a10',
  full_name: 'Sam Mngoma Test',
  avatar_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=300&q=80',
  city: 'Durban',
  role: 'client',
};

const PHOTOGRAPHERS = [
  {
    id: '9a04e8f2-2f3e-4e61-9cb7-97c4f9c39210',
    full_name: 'Michael Scott',
    avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
    city: 'Durban',
    rating: 4.8,
    tags: ['Wedding', 'Portrait'],
    specialties: ['Wedding', 'Portrait'],
    style: 'Wedding',
    hourly_rate: 1800,
    latitude: -29.8587,
    longitude: 31.0218,
  },
  {
    id: '0f1bfa5b-9b7d-49a4-8a8c-0b8447d1a4c2',
    full_name: 'Anna Gomez',
    avatar_url: 'https://images.unsplash.com/photo-1503341455253-b2e723bb3dbb?auto=format&fit=crop&w=300&q=80',
    city: 'Durban',
    rating: 4.9,
    tags: ['Fashion', 'Editorial'],
    specialties: ['Fashion'],
    style: 'Fashion',
    hourly_rate: 1800,
    latitude: -29.865,
    longitude: 31.028,
  },
  {
    id: 'a2a8b1a8-8f14-49ac-8f04-4c7d8cc5b1f3',
    full_name: 'Jason Lee',
    avatar_url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&q=80',
    city: 'Durban',
    rating: 4.7,
    tags: ['Portrait', 'Lifestyle'],
    specialties: ['Portrait'],
    style: 'Portrait',
    hourly_rate: 1800,
    latitude: -29.871,
    longitude: 31.019,
  },
  {
    id: '4b2f7a43-bbd1-41c2-bd08-0cb723cff93d',
    full_name: 'Olivia Harris',
    avatar_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80',
    city: 'Durban',
    rating: 4.9,
    tags: ['Family', 'Lifestyle'],
    specialties: ['Family'],
    style: 'Family',
    hourly_rate: 1800,
    latitude: -29.852,
    longitude: 31.015,
  },
  {
    id: '6d3c94d1-2a93-4a48-8f7c-5cb8b2467f88',
    full_name: 'Lerato Sithole',
    avatar_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=300&q=80',
    city: 'Durban',
    rating: 4.8,
    tags: ['Wedding', 'Lifestyle'],
    specialties: ['Wedding', 'Lifestyle'],
    style: 'Lifestyle',
    hourly_rate: 1800,
    latitude: -29.848,
    longitude: 31.033,
  },
  {
    id: 'e02e3d63-27bc-4d5b-9b0f-bb7a04db4e33',
    full_name: 'Sipho Dlamini',
    avatar_url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&q=80',
    city: 'Durban',
    rating: 4.8,
    tags: ['Portrait', 'Event'],
    specialties: ['Event'],
    style: 'Event',
    hourly_rate: 1800,
    latitude: -29.861,
    longitude: 31.011,
  },
];

const EQUIPMENT_PRESET = {
  camera: ['mirrorless'],
  lenses: ['prime', 'zoom'],
  lighting: ['strobes'],
  extras: ['drone'],
};

const nowIso = new Date().toISOString();

const buildBookings = () => {
  const bookings = [
    {
      id: 'f9b9d2b5-5d2f-4f0f-bdbc-85f1d873f1f0',
      package_type: 'Your bookings',
      booking_date: '2026-03-24T02:00:00+02:00',
      photographer_id: '6d3c94d1-2a93-4a48-8f7c-5cb8b2467f88',
      status: 'pending',
    },
    {
      id: '7bdfe9f7-6cf5-49a4-8c21-1a3cf982f8d2',
      package_type: 'Half-day coverage',
      booking_date: '2026-04-15T02:00:00+02:00',
      photographer_id: 'e02e3d63-27bc-4d5b-9b0f-bb7a04db4e33',
      status: 'pending',
    },
    {
      id: 'a93e6a85-c2b4-4d3a-b55a-5cf0681aa2f3',
      package_type: 'Half-day coverage',
      booking_date: '2026-03-19T02:00:00+02:00',
      photographer_id: 'e02e3d63-27bc-4d5b-9b0f-bb7a04db4e33',
      status: 'pending',
    },
  ];

  return bookings.map((b, idx) => ({
    id: b.id,
    client_id: REFERENCE_CLIENT.id,
    photographer_id: b.photographer_id,
    model_id: null,
    booking_date: b.booking_date,
    package_type: b.package_type,
    status: b.status,
    created_at: nowIso,
    user_latitude: -29.8587,
    user_longitude: 31.0218,
    price_total: 1800 + idx * 150,
    commission_amount: 540,
    photographer_payout: 1260,
    fanout_count: 1,
    intensity_level: 1,
  }));
};

const seedProfiles = async () => {
  const profiles = [
    REFERENCE_CLIENT,
    ...PHOTOGRAPHERS.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
      city: p.city,
      role: 'photographer',
    })),
  ];

  const payload = profiles.map((p) => ({
    id: p.id,
    full_name: p.full_name,
    avatar_url: p.avatar_url,
    city: p.city,
    role: p.role,
    kyc_status: 'approved',
    age_verified: true,
    age_verified_at: nowIso,
    availability_status: 'online',
    is_online: true,
  }));

  const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
  if (error) throw error;
};

const seedPhotographers = async () => {
  const payload = PHOTOGRAPHERS.map((p, idx) => ({
    id: p.id,
    rating: p.rating,
    location: `${p.city}, South Africa`,
    latitude: p.latitude,
    longitude: p.longitude,
    price_range: '$$',
    style: p.style,
    bio: `${p.full_name} specialises in ${p.style.toLowerCase()} work across Durban.`,
    tags: p.tags,
    tier_id: idx % 2 === 0 ? 'premium' : 'professional',
    equipment: EQUIPMENT_PRESET,
    is_available: true,
    hourly_rate: p.hourly_rate,
    experience_years: 6 + idx,
    specialties: p.specialties,
  }));
  const { error } = await supabase.from('photographers').upsert(payload, { onConflict: 'id' });
  if (error) throw error;
};

const seedBookings = async () => {
  const payload = buildBookings();
  const { error } = await supabase.from('bookings').upsert(payload, { onConflict: 'id' });
  if (error) throw error;
};

const main = async () => {
  await seedProfiles();
  await seedPhotographers();
  await seedBookings();
  console.log('Reference data seeded.');
};

main().catch((err) => {
  console.error('Seed failed:', err?.message || err);
  process.exit(1);
});

