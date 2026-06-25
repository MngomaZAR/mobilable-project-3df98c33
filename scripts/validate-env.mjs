#!/usr/bin/env node

import { lookup } from 'node:dns/promises';

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

const checkDns = async (name, url) => {
  if (!url || errors.length > 0) return;
  try {
    await lookup(url.hostname);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'DNS_ERROR';
    errors.push(
      `${name} host ${url.hostname} does not resolve in DNS (${code}). Create the API A/CNAME record before building store binaries.`
    );
  }
};

const checkApiHealth = async (apiBaseUrl) => {
  if (!apiBaseUrl || errors.length > 0) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(new URL('/health', apiBaseUrl).toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      errors.push(`EXPO_PUBLIC_API_BASE_URL /health returned HTTP ${response.status}`);
      return;
    }
    const body = await response.json().catch(() => null);
    if (!body || body.status !== 'ok') {
      errors.push('EXPO_PUBLIC_API_BASE_URL /health did not return { "status": "ok" }');
    }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? 'timed out' : 'could not be reached';
    errors.push(`EXPO_PUBLIC_API_BASE_URL /health ${message}`);
  } finally {
    clearTimeout(timeout);
  }
};

const checkApiContract = async (apiBaseUrl) => {
  if (!apiBaseUrl || errors.length > 0) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(new URL('/health/contract', apiBaseUrl).toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body?.detail ?? body;
      errors.push(`EXPO_PUBLIC_API_BASE_URL /health/contract returned HTTP ${response.status}: ${JSON.stringify(detail)}`);
      return;
    }
    if (!body?.ok) {
      errors.push(`EXPO_PUBLIC_API_BASE_URL /health/contract returned ok=false: ${JSON.stringify(body)}`);
    }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? 'timed out' : 'could not be reached';
    errors.push(`EXPO_PUBLIC_API_BASE_URL /health/contract ${message}`);
  } finally {
    clearTimeout(timeout);
  }
};

const allowedStoreTargets = new Set(['development', 'web', 'internal', 'appstore', 'play', 'both']);
const allowedBillingProviders = new Set(['iap', 'external', 'disabled']);

const backendProvider = read('EXPO_PUBLIC_BACKEND_PROVIDER').toLowerCase() || 'api';
if (!['api', 'supabase', 'nhost'].includes(backendProvider)) {
  errors.push("EXPO_PUBLIC_BACKEND_PROVIDER must be one of 'api', 'supabase', or 'nhost'");
}

if (mode === 'release' && backendProvider !== 'api') {
  errors.push('Release builds must use EXPO_PUBLIC_BACKEND_PROVIDER=api so mobile traffic goes through the deployed FastAPI boundary.');
}

if (backendProvider === 'supabase') {
  const supabaseUrl = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
  requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  validateHostedUrl('EXPO_PUBLIC_SUPABASE_URL', supabaseUrl);
}

if (backendProvider === 'nhost') {
  const nhostSubdomain = requireEnv('EXPO_PUBLIC_NHOST_SUBDOMAIN');
  requireEnv('EXPO_PUBLIC_NHOST_REGION');
  if (mode === 'release' && /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(nhostSubdomain)) {
    errors.push('EXPO_PUBLIC_NHOST_SUBDOMAIN must not point to a local development host in release mode');
  }
  if (read('EXPO_PUBLIC_SUPABASE_URL') || read('EXPO_PUBLIC_SUPABASE_ANON_KEY')) {
    warnings.push('Supabase env values are present but ignored when EXPO_PUBLIC_BACKEND_PROVIDER=nhost');
  }
}

if (backendProvider === 'api') {
  if (read('EXPO_PUBLIC_SUPABASE_URL') || read('EXPO_PUBLIC_SUPABASE_ANON_KEY')) {
    warnings.push('Supabase env values are present but ignored when EXPO_PUBLIC_BACKEND_PROVIDER=api');
  }
  if (read('EXPO_PUBLIC_NHOST_SUBDOMAIN') || read('EXPO_PUBLIC_NHOST_REGION')) {
    warnings.push('Nhost env values are present but should only be used by the server when EXPO_PUBLIC_BACKEND_PROVIDER=api');
  }
}

if (mode === 'release') {
  const apiBaseUrl = validateHostedUrl('EXPO_PUBLIC_API_BASE_URL', requireEnv('EXPO_PUBLIC_API_BASE_URL'));
  if (apiBaseUrl?.hostname === 'api.example.com') {
    errors.push('EXPO_PUBLIC_API_BASE_URL must be set to the real Dokploy/FastAPI API host, not api.example.com');
  }
  await checkDns('EXPO_PUBLIC_API_BASE_URL', apiBaseUrl);
  await checkApiHealth(apiBaseUrl);
  await checkApiContract(apiBaseUrl);

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
