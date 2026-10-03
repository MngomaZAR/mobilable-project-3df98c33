import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.PAPZI_AUDIT_EAS_CLI || path.join(process.env.APPDATA, 'npm/node_modules/eas-cli/bin/run');
if (!fs.existsSync(cli)) throw new Error('The authenticated EAS CLI runtime was not found.');

function query(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CI: '1', EAS_NO_UPDATE_CHECK: '1' },
    maxBuffer: 8 * 1024 * 1024,
  });
  try {
    return { exitCode: result.status, data: JSON.parse(result.stdout) };
  } catch {
    const log = `${result.stdout || ''}\n${result.stderr || ''}`;
    return {
      exitCode: result.status,
      reason: result.error?.code === 'ETIMEDOUT' ? 'timeout'
        : /not found|nonexistent command/i.test(log) ? 'unsupported_cli_command'
          : /log in|not logged/i.test(log) ? 'account_sign_in_required'
            : /credentials|api key|not configured/i.test(log) ? 'credentials_not_resolved'
              : 'no_machine_readable_receipt',
    };
  }
}

const safeKeys = new Set([
  'id', 'status', 'state', 'platform', 'version', 'appVersion', 'appBuildVersion',
  'buildNumber', 'versionCode', 'bundleIdentifier', 'bundleId', 'packageName',
  'ascAppId', 'createdAt', 'updatedAt', 'completedAt', 'submittedAt',
  'appStoreState', 'betaReviewState', 'internalBuildState', 'externalBuildState',
  'processingState', 'gitCommitHash', 'buildProfile', 'name', 'releaseStatus',
  'track', 'expired', 'ascAppIdentifier', 'applicationIdentifier', 'errorCode',
]);

// Provider JSON can contain signed artifact/log URLs and private key fields.
// Preserve status structure but never include those values in a public report.
function sanitize(value, depth = 0) {
  if (depth > 10 || value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, depth + 1)).filter(item => item && Object.keys(item).length);
  if (typeof value !== 'object') return null;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|private|url|email|issuer|certificate|provision/i.test(key)) continue;
    if (safeKeys.has(key) && ['string', 'number', 'boolean'].includes(typeof item)) {
      out[key] = item;
    } else if (item && typeof item === 'object') {
      const child = sanitize(item, depth + 1);
      if (Array.isArray(child) ? child.length : child && Object.keys(child).length) out[key] = child;
    }
  }
  return out;
}

const buildQuery = query(['build:list', '--platform', 'all', '--limit', '30', '--json', '--non-interactive']);
const submissionQuery = query(['submit:list', '--platform', 'all', '--limit', '30', '--json', '--non-interactive']);
// This query includes submission targets/errors which older list output omits.
async function submissionTargets() {
  const require = createRequire(cli);
  const { default: SessionManager } = require('../build/user/SessionManager.js');
  const { createGraphqlClient } = require('../build/commandUtils/context/contextUtils/createGraphqlClient.js');
  const { SubmissionQuery } = require('../build/graphql/queries/SubmissionQuery.js');
  const session = new SessionManager({ setActor() {} });
  const client = createGraphqlClient({ accessToken: session.getAccessToken(), sessionSecret: session.getSessionSecret() });
  try {
    const rows = await SubmissionQuery.forProjectStatusAsync(client, 'f0c1ef90-ac26-4e4c-a799-77b377e2f452', { limit: 30, offset: 0 });
    return rows.map(row => ({ ...sanitize(row), failureCategory: categorizeFailure(row.error?.message) }));
  } catch {
    return { reason: 'authenticated_submission_target_query_failed' };
  }
}

function categorizeFailure(message) {
  if (!message) return undefined;
  const known = [
    ['first_upload_required', /first.*upload|first.*manually|has not been uploaded/i],
    ['publisher_permission_denied', /permission|not authorized|forbidden/i],
    ['package_not_found', /package.*not found|application.*not found/i],
    ['version_already_used', /version.*already|already.*version|redundant binary/i],
    ['invalid_credentials', /credential|invalid.*key|authentication|jwt/i],
    ['signing_mismatch', /certificate|provision|signing|bundle.*match/i],
    ['invalid_bundle', /invalid.*bundle|bundle.*invalid|optimization/i],
  ];
  return known.find(([, pattern]) => pattern.test(message))?.[0] || 'provider_error_requires_private_log_review';
}
const targets = await submissionTargets();
const currentStoreQuery = query(['submit:status', '--json', '--non-interactive']);
const report = {
  checkedAt: new Date().toISOString(),
  scope: 'Read-only EAS build/submission receipts and App Store Connect status; no build or submission triggered.',
  projectId: 'f0c1ef90-ac26-4e4c-a799-77b377e2f452',
  builds: Array.isArray(buildQuery.data) ? buildQuery.data.map(build => ({
    id: build.id, platform: build.platform, status: build.status,
    appVersion: build.appVersion, appBuildVersion: build.appBuildVersion,
    gitCommitHash: build.gitCommitHash, buildProfile: build.buildProfile,
    createdAt: build.createdAt, completedAt: build.completedAt,
    artifactAvailable: Boolean(build.artifacts?.buildUrl),
  })) : { exitCode: buildQuery.exitCode, reason: buildQuery.reason },
  submissions: submissionQuery.data ? sanitize(submissionQuery.data)
    : { exitCode: submissionQuery.exitCode, reason: submissionQuery.reason },
  submissionTargets: targets,
  appStoreStatus: currentStoreQuery.data ? sanitize(currentStoreQuery.data)
    : { exitCode: currentStoreQuery.exitCode, reason: currentStoreQuery.reason },
  warning: 'FINISHED build status is not evidence of upload, tester availability, successful user journeys or public approval. Google Play production state is not provided by EAS submit:status.',
};
const destination = path.join(root, 'docs/store-history-20261003.json');
fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  report: path.relative(root, destination),
  builds: Array.isArray(report.builds) ? report.builds.slice(0, 8) : report.builds,
  submissionTargets: Array.isArray(targets) ? targets.slice(0, 10) : targets,
  appStoreStatus: report.appStoreStatus,
}, null, 2));
