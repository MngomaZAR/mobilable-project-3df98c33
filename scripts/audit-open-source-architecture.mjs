#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const toPosix = (value) => value.split(path.sep).join('/');

const walk = async (dir) => {
  const absolute = path.join(root, dir);
  const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(entry.name)) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(rel)));
    else files.push(rel);
  }
  return files;
};

const read = async (rel) => fs.readFile(path.join(root, rel), 'utf8');

const sourceFiles = (await walk('src')).filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
const screenModules = sourceFiles.filter((file) => toPosix(file).startsWith('src/screens/') && file.endsWith('.tsx'));
const serviceModules = sourceFiles.filter((file) => toPosix(file).startsWith('src/services/') && file.endsWith('.ts'));
const scriptFiles = (await walk('scripts')).filter((file) => /\.(mjs|cjs|js|ts|ps1|md)$/.test(file));

const providerPatterns = [
  { provider: 'supabase', pattern: /\bsupabase\b|supabaseClient|@supabase\/supabase-js/g },
  { provider: 'nhost', pattern: /\bnhost\b|nhostClient|@nhost\/nhost-js|hasuraGQL/g },
  { provider: 'legacy-provider', pattern: /legacyProviderClient|legacyDb|hasLegacyDb|legacyFunctionUrl|legacyPublishableKey|legacyRestUrl/g },
];

const releaseBoundaryRoots = ['src/screens/', 'src/components/', 'src/store/'];
const allowedProviderRoots = ['src/config/', 'src/services/'];

const providerFindings = [];
const providerCounts = {
  supabase: { files: new Set(), hits: 0 },
  nhost: { files: new Set(), hits: 0 },
  'legacy-provider': { files: new Set(), hits: 0 },
};

for (const file of sourceFiles) {
  const rel = toPosix(file);
  const content = await read(file);
  for (const { provider, pattern } of providerPatterns) {
    const matches = [...content.matchAll(pattern)];
    if (matches.length === 0) continue;
    providerCounts[provider].files.add(rel);
    providerCounts[provider].hits += matches.length;
    const isReleaseBoundary = releaseBoundaryRoots.some((prefix) => rel.startsWith(prefix));
    const isAllowedProviderLayer = allowedProviderRoots.some((prefix) => rel.startsWith(prefix));
    if ((provider === 'supabase' || provider === 'legacy-provider') && isReleaseBoundary && !isAllowedProviderLayer) {
      const first = matches[0];
      const line = content.slice(0, first.index ?? 0).split(/\r?\n/).length;
      providerFindings.push({
        type: 'direct_provider_dependency',
        provider,
        file: rel,
        line,
        message: 'Screens, components, and stores must call FastAPI/domain services instead of legacy provider clients directly.',
      });
    }
  }
}

const currentEnv = await read('eas.json').catch(() => '{}');
const releaseProviderIsExplicitNhost =
  /"production"\s*:\s*{[\s\S]*?"env"\s*:\s*{[\s\S]*?"EXPO_PUBLIC_BACKEND_PROVIDER"\s*:\s*"nhost"/.test(currentEnv);

const appConfig = await read('app.config.js').catch(() => '');
const appDefaultProviderIsNhost = /EXPO_PUBLIC_BACKEND_PROVIDER:[^\n]*\|\|\s*["']nhost["']/.test(appConfig);

const blockers = [];

if (screenModules.length !== 44) {
  blockers.push({
    type: 'screen_inventory_mismatch',
    expected: 44,
    actual: screenModules.length,
    message: 'The public screen inventory changed. Update docs and audits before release.',
  });
}

if (!releaseProviderIsExplicitNhost) {
  blockers.push({
    type: 'release_provider_not_nhost',
    file: 'eas.json',
    message: 'Production EAS config must explicitly set EXPO_PUBLIC_BACKEND_PROVIDER=nhost.',
  });
}

if (!appDefaultProviderIsNhost) {
  blockers.push({
    type: 'app_default_provider_not_nhost',
    file: 'app.config.js',
    message: 'App config should default to Nhost so missing env does not silently fall back to Supabase.',
  });
}

blockers.push(...providerFindings);

const result = {
  summary: {
    screens: screenModules.length,
    services: serviceModules.length,
    scripts: scriptFiles.length,
    supabaseFiles: providerCounts.supabase.files.size,
    supabaseHits: providerCounts.supabase.hits,
    nhostFiles: providerCounts.nhost.files.size,
    nhostHits: providerCounts.nhost.hits,
    legacyProviderFiles: providerCounts['legacy-provider'].files.size,
    legacyProviderHits: providerCounts['legacy-provider'].hits,
    blockers: blockers.length,
  },
  screenModules: screenModules.map(toPosix).sort(),
  serviceModules: serviceModules.map(toPosix).sort(),
  blockers,
};

console.log(JSON.stringify(result, null, 2));

if (blockers.length > 0) {
  console.error('Open-source architecture audit failed: release backend boundaries are not aligned yet.');
  process.exit(1);
}
