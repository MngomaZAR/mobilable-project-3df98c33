#!/usr/bin/env node

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = (modeArg ? modeArg.split('=')[1] : 'ci').toLowerCase();

const errors = [];
const warnings = [];

const read = (name) => (process.env[name] ?? '').trim();
const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());

const requireEnv = (name) => {
  const value = read(name);
  if (!value) {
    errors.push(`${name} is required`);
  }
  return value;
};

const validateSupabaseUrl = (value) => {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      warnings.push('EXPO_PUBLIC_SUPABASE_URL should use https');
    }
  } catch {
    errors.push('EXPO_PUBLIC_SUPABASE_URL must be a valid URL');
  }
};

const allowedStoreTargets = new Set(['development', 'web', 'internal', 'appstore', 'play', 'both']);
const allowedBillingProviders = new Set(['iap', 'external', 'disabled']);

const supabaseUrl = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
validateSupabaseUrl(supabaseUrl);

if (mode === 'release') {
  const storeTarget = requireEnv('EXPO_PUBLIC_STORE_TARGET').toLowerCase();
  const billingProvider = requireEnv('EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER').toLowerCase();
  const disableDigital = read('EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES');

  if (!allowedStoreTargets.has(storeTarget)) {
    errors.push(`EXPO_PUBLIC_STORE_TARGET must be one of: ${[...allowedStoreTargets].join(', ')}`);
  }
  if (!allowedBillingProviders.has(billingProvider)) {
    errors.push(`EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER must be one of: ${[...allowedBillingProviders].join(', ')}`);
  }
  if (!disableDigital) {
    errors.push('EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES is required for release mode');
  }

  const targetsStore = storeTarget === 'appstore' || storeTarget === 'play' || storeTarget === 'both';
  const digitalDisabled = isTruthy(disableDigital);
  if (targetsStore && !digitalDisabled && billingProvider !== 'iap') {
    errors.push(
      'Store-targeted release has non-IAP digital billing enabled. Set EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=true or EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER=iap.'
    );
  }
}

if (errors.length > 0) {
  console.error(`Environment validation failed (${mode} mode):`);
  for (const error of errors) console.error(`- ${error}`);
  for (const warning of warnings) console.error(`! ${warning}`);
  process.exit(1);
}

console.log(`Environment validation passed (${mode} mode).`);
for (const warning of warnings) console.log(`! ${warning}`);
