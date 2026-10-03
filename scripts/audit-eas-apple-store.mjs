import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const cli = process.env.PAPZI_AUDIT_EAS_CLI;
if (!cli || !fs.existsSync(cli)) throw new Error('Set PAPZI_AUDIT_EAS_CLI to the authenticated EAS runtime.');
const require = createRequire(cli);
const { default: SessionManager } = require('../build/user/SessionManager.js');
const { createGraphqlClient } = require('../build/commandUtils/context/contextUtils/createGraphqlClient.js');
const { AppStoreConnectApiKeyQuery: ListKeys } = require('../build/credentials/ios/api/graphql/queries/AppStoreConnectApiKeyQuery.js');
const { AppStoreConnectApiKeyQuery: ReadKey } = require('../build/graphql/queries/AppStoreConnectApiKeyQuery.js');
const session = new SessionManager({ setActor() {} });
const client = createGraphqlClient({ accessToken: session.getAccessToken(), sessionSecret: session.getSessionSecret() });
const keys = await ListKeys.getAllForAccountAsync(client, 'papz');
const receipts = [];
for (const metadata of keys.slice(0, 10)) {
  try {
    const key = await ReadKey.getByIdAsync(client, metadata.id);
    const output = path.resolve(`docs/apple-store-eas-${metadata.keyIdentifier}-20261004.json`);
    // Secrets are passed only in the child environment, not arguments, files or logs.
    const child = spawnSync(process.env.PAPZI_AUDIT_PYTHON || 'python', ['scripts/audit-apple-store.py'], {
      encoding: 'utf8', timeout: 150000, maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        APPLE_API_KEY_ID: key.keyIdentifier,
        APPLE_API_ISSUER_ID: key.issuerIdentifier,
        APPLE_API_KEY_P8_BASE64: Buffer.from(key.keyP8).toString('base64'),
        STORE_AUDIT_OUTPUT: output,
      },
    });
    if (child.status !== 0 || !fs.existsSync(output)) {
      receipts.push({ keyIdentifier: metadata.keyIdentifier, reason: 'store_query_runtime_failed' });
      continue;
    }
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    receipts.push({ keyIdentifier: metadata.keyIdentifier, report: path.relative(process.cwd(), output),
      checkedAt: report.checkedAt, apps: report.apps.map(app => ({ bundleIdentifier: app.bundleIdentifier,
        lookupStatus: app.appLookup.status, errorCodes: app.appLookup.errorCodes,
        storeStates: app.storeVersions?.resources?.map(row => row.attributes?.appStoreState),
        latestBuild: app.builds?.resources?.find(row => row.type === 'builds')?.attributes })) });
    const authenticated = report.apps.some(app => app.appLookup.status === 200 ||
      app.appLookup.errorCodes?.includes('FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED'));
    if (process.env.SYNC_EXISTING_GITHUB_APPLE_SECRETS === 'true' && authenticated) {
      const sync = spawnSync(process.env.PAPZI_SECRET_SYNC_PYTHON || 'python', ['scripts/sync-github-apple-secrets.py'], {
        encoding: 'utf8', timeout: 120000, maxBuffer: 65536,
        input: JSON.stringify({
          APPLE_API_KEY_ID: key.keyIdentifier,
          APPLE_API_ISSUER_ID: key.issuerIdentifier,
          APPLE_API_KEY_P8_BASE64: Buffer.from(key.keyP8).toString('base64'),
        }),
      });
      let summary = { reason: 'sync_did_not_return_a_safe_receipt' };
      try { summary = JSON.parse(sync.stdout); } catch {}
      receipts.push({ githubSecretSync: summary, exitCode: sync.status });
    }
    if (report.apps.some(app => app.appLookup.status === 200)) break;
  } catch {
    receipts.push({ keyIdentifier: metadata.keyIdentifier, reason: 'existing_eas_key_could_not_be_resolved' });
  }
}
console.log(JSON.stringify({ readOnly: true, credentialSource: 'Existing authenticated EAS papz account', keyCount: keys.length, receipts }, null, 2));
