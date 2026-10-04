import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const cli = process.env.PAPZI_AUDIT_EAS_CLI;
if (!cli || !fs.existsSync(cli)) throw new Error('Set PAPZI_AUDIT_EAS_CLI to the authenticated EAS runtime.');
const projectId = 'f0c1ef90-ac26-4e4c-a799-77b377e2f452';
const sourcePackage = 'com.saicts.papzi';
const targetPackage = 'com.papziiii.paparazzi';
const expectedSha256 = '2DC2CF575A2FF4F4E57C2D7BA3A4B12E258EF6CD83E4B0424D406302CF5CDCEA';
const normalize = value => String(value || '').replace(/:/g, '').toUpperCase();
const apply = process.argv.includes('--apply');
const linkSubmission = process.argv.includes('--link-submission');
const expectedServiceAccount = 'firebase-adminsdk-fbsvc@papz-601b5.iam.gserviceaccount.com';
const matchesServiceAccount = key => key?.projectIdentifier === 'papz-601b5'
  && key?.clientEmail === expectedServiceAccount;
assert.equal(JSON.parse(fs.readFileSync('eas.json', 'utf8')).build.production.env.EXPO_ANDROID_PACKAGE, targetPackage);

const require = createRequire(cli);
const { default: SessionManager } = require('../build/user/SessionManager.js');
const { createGraphqlClient } = require('../build/commandUtils/context/contextUtils/createGraphqlClient.js');
const { AndroidAppCredentialsQuery } = require('../build/credentials/android/api/graphql/queries/AndroidAppCredentialsQuery.js');
const { AndroidAppCredentialsMutation } = require('../build/credentials/android/api/graphql/mutations/AndroidAppCredentialsMutation.js');
const { AndroidAppBuildCredentialsMutation } = require('../build/credentials/android/api/graphql/mutations/AndroidAppBuildCredentialsMutation.js');
const session = new SessionManager({ setActor() {} });
const client = createGraphqlClient({ accessToken: session.getAccessToken(), sessionSecret: session.getSessionSecret() });
const read = androidApplicationIdentifier => AndroidAppCredentialsQuery.withCommonFieldsByApplicationIdentifierAsync(
  client, '@papz/papzi', { androidApplicationIdentifier, legacyOnly: false },
);
const source = await read(sourcePackage);
assert.equal(source?.app?.id, projectId, 'Unexpected source EAS project.');
const sourceBuild = source.androidAppBuildCredentialsList.find(row => row.isDefault);
assert.equal(normalize(sourceBuild?.androidKeystore?.sha256CertificateFingerprint), expectedSha256,
  'Existing source key does not match the upload certificate verified in Play Console.');

let target = await read(targetPackage);
if (target) assert.equal(target.app.id, projectId, 'Unexpected target EAS project.');
const sourceSubmission = source.googleServiceAccountKeyForSubmissions;
if (linkSubmission) {
  assert.ok(matchesServiceAccount(sourceSubmission), 'Source submission credential is not the approved service account.');
  if (target?.googleServiceAccountKeyForSubmissions) {
    assert.equal(target.googleServiceAccountKeyForSubmissions.id, sourceSubmission.id,
      'Conflicting target submission credential; no credentials were overwritten.');
  }
}
const existing = target?.androidAppBuildCredentialsList || [];
for (const row of existing) {
  assert.equal(normalize(row.androidKeystore?.sha256CertificateFingerprint), expectedSha256,
    'Conflicting target signing key; no credentials were overwritten.');
}
let changed = false;
let submissionChanged = false;
if (apply && !existing.some(row => row.isDefault)) {
  if (existing.length) throw new Error('Target has a non-default credential record; select it explicitly in EAS.');
  target ||= await AndroidAppCredentialsMutation.createAndroidAppCredentialsAsync(client, {}, projectId, targetPackage);
  // Associate the already accepted key by ID. Never generate, export or reset it.
  await AndroidAppBuildCredentialsMutation.createAndroidAppBuildCredentialsAsync(client, {
    name: 'Existing Play upload key', isDefault: true, keystoreId: sourceBuild.androidKeystore.id,
  }, target.id);
  changed = true;
}
if (apply && linkSubmission && !target?.googleServiceAccountKeyForSubmissions) {
  assert.ok(target, 'Configure the verified signing record before linking submission credentials.');
  await AndroidAppCredentialsMutation.setGoogleServiceAccountKeyForSubmissionsAsync(
    client, target.id, sourceSubmission.id,
  );
  submissionChanged = true;
}
if (apply) target = await read(targetPackage);
const verified = target?.androidAppBuildCredentialsList.find(row => row.isDefault);
if (apply) assert.equal(normalize(verified?.androidKeystore?.sha256CertificateFingerprint), expectedSha256,
  'Post-write signing verification failed.');
if (apply && linkSubmission) {
  assert.equal(target.googleServiceAccountKeyForSubmissions?.id, sourceSubmission.id,
    'Post-write submission credential verification failed.');
}

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), readOnly: !apply, changed, submissionChanged,
  project: '@papz/papzi', sourcePackage, targetPackage,
  uploadCertificateSha256: expectedSha256,
  targetSigningReady: normalize(verified?.androidKeystore?.sha256CertificateFingerprint) === expectedSha256,
  sourceSubmissionEligible: matchesServiceAccount(sourceSubmission),
  targetSubmissionReady: matchesServiceAccount(target?.googleServiceAccountKeyForSubmissions),
  note: 'No private key, password, service-account data or store submission is included in this receipt.' }, null, 2));
