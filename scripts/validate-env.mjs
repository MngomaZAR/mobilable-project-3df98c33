#!/usr/bin/env node

import { loadLocalEnv } from './lib/load-env-file.mjs';

loadLocalEnv();

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

const validateHostedUrl = (name, value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      warnings.push(`${name} should use https`);
    }
    const hostname = url.hostname.toLowerCase();
    const isLocalhost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.localhost');
    if (mode === 'release' && isLocalhost) {
      errors.push(`${name} must not point to a local development host in release mode`);
    }
    return url;
  } catch {
    errors.push(`${name} must be a valid URL`);
    return null;
  }
};

const allowedStoreTargets = new Set(['development', 'web', 'internal', 'appstore', 'play', 'both']);
const allowedBillingProviders = new Set(['iap', 'external', 'disabled']);

const supabaseUrl = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
validateHostedUrl('EXPO_PUBLIC_SUPABASE_URL', supabaseUrl);

const backendProvider = read('EXPO_PUBLIC_BACKEND_PROVIDER').toLowerCase() || 'supabase';
if (!['supabase', 'nhost'].includes(backendProvider)) {
  errors.push("EXPO_PUBLIC_BACKEND_PROVIDER must be either 'supabase' or 'nhost'");
}

if (backendProvider === 'nhost') {
  const nhostSubdomain = requireEnv('EXPO_PUBLIC_NHOST_SUBDOMAIN');
  requireEnv('EXPO_PUBLIC_NHOST_REGION');
  if (mode === 'release' && /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(nhostSubdomain)) {
    errors.push('EXPO_PUBLIC_NHOST_SUBDOMAIN must not point to a local development host in release mode');
  }
}

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
