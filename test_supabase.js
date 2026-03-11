const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

async function check() {
  const { data: p } = await supabase.from('profiles').select('*').limit(1);
  if(p && p.length) console.log('PROFILES:', Object.keys(p[0]).join(', '));
  else console.log('PROFILES EMPTY');

  const { data: b } = await supabase.from('bookings').select('*').limit(1);
  if(b && b.length) console.log('BOOKINGS:', Object.keys(b[0]).join(', '));
  else console.log('BOOKINGS EMPTY');
  
  const { data: c } = await supabase.from('conversation_participants').select('*').limit(1);
  if(c && c.length) console.log('CONV_PARTS:', Object.keys(c[0]).join(', '));
  else console.log('CONV_PARTS EMPTY');
}

check();
