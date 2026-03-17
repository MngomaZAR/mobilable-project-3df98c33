const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  "https://mizdvqhvspkjayffaqqd.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pemR2cWh2c3BramF5ZmZhcXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNjg0NzksImV4cCI6MjA4Mjk0NDQ3OX0.WBEcxhd0WFpay_J9l2_A1wpfkbpcIUiAQnp1VeMvNjY"
);

async function testKycValues() {
  console.log("Attempting sign in...");
  const { data: user, error: userError } = await supabase.auth.signInWithPassword({
      email: 'smngoma22@gmail.com',
      password: 'Sthembiso@1'
  });
  if(userError) {
      console.log('Login Error', userError);
      return;
  }
  
  const valuesToTest = ['verified', 'completed', 'approved', 'age_verified', 'confirmed'];
  
  for (const val of valuesToTest) {
      console.log(`Testing value: ${val}...`);
      const { data, error } = await supabase
        .from('profiles')
        .update({ kyc_status: val })
        .eq('id', user.user.id)
        .select();
        
      if (error) {
          console.log(`  Value '${val}' failed:`, error.message);
      } else {
          console.log(`  Value '${val}' SUCCESS!`);
          break;
      }
  }
}

testKycValues();
