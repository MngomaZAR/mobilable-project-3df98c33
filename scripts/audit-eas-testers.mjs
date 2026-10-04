import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const cli = process.env.PAPZI_AUDIT_EAS_CLI;
if (!cli || !fs.existsSync(cli)) throw new Error('Use the existing authenticated EAS runtime.');
const require = createRequire(cli);
const { default: SessionManager } = require('../build/user/SessionManager.js');
const { createGraphqlClient } = require('../build/commandUtils/context/contextUtils/createGraphqlClient.js');
const { AppStoreConnectApiKeyQuery: List } = require('../build/credentials/ios/api/graphql/queries/AppStoreConnectApiKeyQuery.js');
const { AppStoreConnectApiKeyQuery: Read } = require('../build/graphql/queries/AppStoreConnectApiKeyQuery.js');
const session = new SessionManager({ setActor() {} });
const client = createGraphqlClient({ accessToken: session.getAccessToken(), sessionSecret: session.getSessionSecret() });
const metadata = (await List.getAllForAccountAsync(client, 'papz')).find(row => row.keyIdentifier === '8NSCTU6X72');
if (!metadata) throw new Error('The previously accepted Apple key was not found.');
const key = await Read.getByIdAsync(client, metadata.id);
const child = spawnSync(process.env.PAPZI_AUDIT_PYTHON || 'python', ['scripts/audit-testflight-testers.py'], {
  encoding: 'utf8', timeout: 180000, maxBuffer: 500000,
  env: { ...process.env, APPLE_API_KEY_ID: key.keyIdentifier, APPLE_API_ISSUER_ID: key.issuerIdentifier,
    APPLE_API_KEY_P8_BASE64: Buffer.from(key.keyP8).toString('base64') },
});
if (child.status !== 0) {
  // No raw child trace, private key or authentication headers in the receipt.
  console.log(JSON.stringify({ readOnly: true, reason: 'tester_inventory_runtime_failed' }));
  process.exitCode = 1;
} else console.log(child.stdout);
