const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mizdvqhvspkjayffaqqd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pemR2cWh2c3BramF5ZmZhcXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNjg0NzksImV4cCI6MjA4Mjk0NDQ3OX0.WBEcxhd0WFpay_J9l2_A1wpfkbpcIUiAQnp1VeMvNjY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyIntegrity() {
  console.log('--- Papzi Database Integrity Check ---');

  // 1. Check bookings table
  console.log('\nChecking "bookings" table...');
  const { data: bookings, error: bError } = await supabase.from('bookings').select('id').limit(1);
  if (bError) {
    console.error('❌ Bookings table check failed:', bError.message);
  } else {
    console.log('✅ Bookings table exists.');
  }

  // 2. Check post_likes table
  console.log('\nChecking "post_likes" table...');
  const { data: likes, error: lError } = await supabase.from('post_likes').select('id').limit(1);
  if (lError) {
    console.error('❌ post_likes table check failed:', lError.message);
  } else {
    console.log('✅ post_likes table exists.');
  }

  // 3. Check messages schema
  console.log('\nChecking "messages" columns (body, chat_id)...');
  const { data: msgs, error: mError } = await supabase.from('messages').select('id, body, chat_id').limit(1);
  if (mError) {
    console.error('❌ messages column check failed:', mError.message);
  } else {
    console.log('✅ messages columns (body, chat_id) exist. This is the LEGACY schema.');
  }

  console.log('\n--- Check Complete ---');
}

verifyIntegrity();
