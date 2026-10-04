import fs from 'node:fs';
import { createRequire } from 'node:module';

const cli = process.env.PAPZI_AUDIT_EAS_CLI;
if (!cli || !fs.existsSync(cli)) throw new Error('Set the authenticated EAS runtime path.');
const require = createRequire(cli);
const { default: SessionManager } = require('../build/user/SessionManager.js');
const { createGraphqlClient } = require('../build/commandUtils/context/contextUtils/createGraphqlClient.js');
const { SubmissionQuery } = require('../build/graphql/queries/SubmissionQuery.js');
const session = new SessionManager({ setActor() {} });
const client = createGraphqlClient({ accessToken: session.getAccessToken(), sessionSecret: session.getSessionSecret() });
const id = process.env.PAPZI_AUDIT_SUBMISSION_ID || 'ee8e12fd-14d6-4f43-8a98-a84335ff6d89';
if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Use an explicit submission UUID.');
const row = await SubmissionQuery.byIdAsync(client, id, { useCache: false });
const categories = [
  ['publisher_permission_denied', /caller does not have permission|permission denied|insufficient permission|insufficientPermission/i],
  ['publisher_api_disabled', /api.*has not been used|accessNotConfigured|SERVICE_DISABLED/i],
  ['package_not_found_or_first_upload_required', /package.*not found|application.*not found|first.*manually|has not been uploaded/i],
  ['version_code_already_used', /version.*already.*used|already.*version/i],
  ['apk_instead_of_bundle', /APKs are not allowed|only.*app bundles/i],
  ['draft_only_app', /only releases with status draft/i],
  ['invalid_service_account', /invalid_grant|invalid.*jwt|invalid.*service account|invalid.*credential/i],
  ['bundle_parser_or_optimization_failed', /optimization|invalid.*bundle|bundle.*invalid/i],
];
let logsRead = 0;
const causes = new Set();
function classify(text) {
  for (const [category, pattern] of categories) if (pattern.test(text)) causes.add(category);
}
classify(row.error?.message || '');
for (const url of (row.logFiles || []).slice(0, 8)) {
  if (typeof url !== 'string' || !url.startsWith('https://')) continue;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (response.ok) {
      const text = await response.text();
      if (text.length <= 4 * 1024 * 1024) { classify(text); logsRead += 1; }
    }
  } catch {}
}
const report = { checkedAt: new Date().toISOString(), readOnly: true, submissionId: id, status: row.status,
  errorCode: row.error?.errorCode, logsRead, causes: [...causes],
  note: 'Provider log URLs, credential values and account emails are intentionally excluded. No submission retried.' };
fs.writeFileSync(process.env.PAPZI_SUBMISSION_AUDIT_OUTPUT || 'docs/android-submission-audit-20261004.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
