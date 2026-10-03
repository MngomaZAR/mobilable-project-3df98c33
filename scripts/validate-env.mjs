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
      if (mode === 'release') {
        errors.push(`${name} must use https in release mode`);
        return null;
      }
      warnings.push(`${name} should use https`);
    }
    const hostname = url.hostname.toLowerCase();
    const isLocalhost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost');
    if (mode === 'release' && isLocalhost) {
      errors.push(`${name} must not point to a local development host in release mode`);
      return null;
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

const checkApiReadiness = async (apiBaseUrl) => {
  if (!apiBaseUrl) return;
  try {
    const response = await fetch(new URL('/health/readiness', apiBaseUrl), {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.required_capabilities_available !== true) {
      errors.push(`Public release readiness failed: ${body?.blockers?.join(', ') || `HTTP ${response.status}; no capability evidence`}. A healthy API is not a complete marketplace.`);
    }
  } catch {
    errors.push('Public release readiness endpoint is unreachable. Do not submit an unverified backend.');
  }
};

const checkApiRouting = async (apiBaseUrl) => {
  if (!apiBaseUrl) return;
  try {
    const endpoint = new URL('/routing/route?start_lat=-29.85&start_lng=31.03&end_lat=-29.87&end_lng=31.04', apiBaseUrl);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(12000) });
    const route = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(route?.coordinates) || route.coordinates.length <= 2 || !(route.duration > 0) || !(route.distance > 0)) {
      errors.push(`Backend road routing failed its real-geometry probe (HTTP ${response.status}). Configure OSRM_BASE_URL on Oracle, not a mobile public key.`);
    }
  } catch {
    errors.push('Backend road routing is unreachable. Do not ship invented routes or ETAs.');
  }
};

const allowedStoreTargets = new Set(['development', 'web', 'internal', 'appstore', 'play', 'both']);
const allowedBillingProviders = new Set(['iap', 'external', 'disabled']);
const publicOsrmHosts = new Set(['router.project-osrm.org']);

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
  } else if (!['true', 'false'].includes(disableDigital.toLowerCase())) {
    errors.push('EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES must be true or false in release mode');
  }

  const targetsStore = storeTarget === 'appstore' || storeTarget === 'play' || storeTarget === 'both';
  if (targetsStore && backendProvider === 'api') await checkApiReadiness(apiBaseUrl);
  const digitalDisabled = isTruthy(disableDigital);
  if (targetsStore && !digitalDisabled && billingProvider !== 'iap') {
    errors.push(
      'Store-targeted release has non-IAP digital billing enabled. Set EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=true or EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER=iap.'
    );
  }

  const routingProvider = read('EXPO_PUBLIC_ROUTING_PROVIDER').toLowerCase() || 'osrm';
  if (!['osrm', 'ors'].includes(routingProvider)) {
    errors.push("EXPO_PUBLIC_ROUTING_PROVIDER must be one of 'osrm' or 'ors'");
  }
  if (backendProvider === 'api') {
    await checkApiRouting(apiBaseUrl);
  } else if (routingProvider === 'osrm') {
    const osrmBaseUrl = validateHostedUrl('EXPO_PUBLIC_OSRM_BASE_URL', requireEnv('EXPO_PUBLIC_OSRM_BASE_URL'));
    if (targetsStore && osrmBaseUrl && publicOsrmHosts.has(osrmBaseUrl.hostname.toLowerCase())) {
      errors.push(
        'Store-targeted releases must not use the public OSRM demo server. Set EXPO_PUBLIC_OSRM_BASE_URL to a self-hosted OSRM endpoint or use EXPO_PUBLIC_ROUTING_PROVIDER=ors with a production key.'
      );
    }
  }
  if (backendProvider !== 'api' && routingProvider === 'ors') {
    requireEnv('EXPO_PUBLIC_OPENROUTESERVICE_API_KEY');
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
