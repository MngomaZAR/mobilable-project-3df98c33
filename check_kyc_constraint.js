const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const TEST_EMAIL = process.env.TEST_LOGIN_EMAIL || '';
const TEST_PASSWORD = process.env.TEST_LOGIN_PASSWORD || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
  console.error(
    'Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL, SUPABASE_ANON_KEY/EXPO_PUBLIC_SUPABASE_ANON_KEY, TEST_LOGIN_EMAIL, or TEST_LOGIN_PASSWORD'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testKycValues() {
  console.log('Attempting sign in...');

  const { data, error: authError } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (authError || !data?.user) {
    console.log('Login error:', authError?.message || 'No user returned');
    return;
  }

  const valuesToTest = ['verified', 'completed', 'approved', 'age_verified', 'confirmed'];

  for (const value of valuesToTest) {
    console.log(`Testing value: ${value}...`);
    const { error } = await supabase
      .from('profiles')
      .update({ kyc_status: value })
      .eq('id', data.user.id)
      .select();

    if (error) {
      console.log(`  Value '${value}' failed: ${error.message}`);
    } else {
      console.log(`  Value '${value}' success`);
      break;
    }
  }
}

testKycValues();
