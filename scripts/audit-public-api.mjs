import fs from 'node:fs';

const base = new URL(process.env.PAPZI_PUBLIC_API_URL || 'https://papzii-api.129.151.188.15.nip.io');
if (base.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0)/.test(base.hostname)) throw new Error('Public API evidence requires a hosted HTTPS endpoint.');
const endpoints = [
  ['health', '/health'], ['version', '/version'], ['contract', '/health/contract'],
  ['readiness', '/health/readiness'],
  ['routing', '/routing/route?start_lat=-29.85&start_lng=31.03&end_lat=-29.87&end_lng=31.04'],
  ['unauthenticated', '/auth/me'],
];
const results = {};
for (const [name, path] of endpoints) {
  try {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => null);
    results[name] = { status: response.status };
    if (name === 'health') Object.assign(results[name], { ok: body?.status === 'ok', environment: body?.environment });
    if (name === 'version') Object.assign(results[name], { revision: body?.version, environment: body?.environment });
    if (name === 'contract') Object.assign(results[name], { ok: body?.ok === true });
    if (name === 'readiness') Object.assign(results[name], { required_capabilities_available: body?.required_capabilities_available === true, blockers: body?.blockers ?? [], capabilities: body?.capabilities ?? {} });
    if (name === 'routing') Object.assign(results[name], { road_route_points: body?.coordinates?.length ?? 0, distance: body?.distance, duration: body?.duration });
  } catch (error) {
    results[name] = { reason: error instanceof Error ? error.name : 'RequestFailed' };
  }
}
const corePassed = results.health.status === 200 && results.health.ok && results.health.environment === 'production' &&
  results.version.status === 200 && results.contract.status === 200 && results.contract.ok &&
  results.readiness.status === 200 && results.routing.status === 200 && results.routing.road_route_points > 2 &&
  results.routing.distance > 0 && results.routing.duration > 0 && results.unauthenticated.status === 401;
const report = { checkedAt: new Date().toISOString(), readOnly: true, api: base.origin, corePassed,
  publicReleaseReady: false, deviceAndSettlementAcceptanceRequired: true, results };
const output = process.env.PAPZI_PUBLIC_AUDIT_OUTPUT || 'docs/production-runtime-20261004.json';
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!corePassed) process.exitCode = 1;
