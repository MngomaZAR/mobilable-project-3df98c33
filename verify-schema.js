const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL or SUPABASE_ANON_KEY/EXPO_PUBLIC_SUPABASE_ANON_KEY'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyIntegrity() {
  console.log('--- Papzi Database Integrity Check ---');

  console.log('\nChecking "bookings" table...');
  const { error: bookingsError } = await supabase.from('bookings').select('id').limit(1);
  if (bookingsError) {
    console.error('Bookings table check failed:', bookingsError.message);
  } else {
    console.log('Bookings table exists.');
  }

  console.log('\nChecking "post_likes" table...');
  const { error: likesError } = await supabase.from('post_likes').select('id').limit(1);
  if (likesError) {
    console.error('post_likes table check failed:', likesError.message);
  } else {
    console.log('post_likes table exists.');
  }

  console.log('\nChecking "messages" columns (body, chat_id)...');
  const { error: messagesError } = await supabase.from('messages').select('id, body, chat_id').limit(1);
  if (messagesError) {
    console.error('messages column check failed:', messagesError.message);
  } else {
    console.log('messages columns (body, chat_id) exist. This is the legacy schema.');
  }

  console.log('\n--- Check Complete ---');
}

verifyIntegrity();
