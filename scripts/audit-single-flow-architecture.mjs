import fs from 'fs';
import path from 'path';

const root = process.cwd();

const forbiddenPaths = [
  'supabase/functions/payfast-itn',
  'supabase/functions/payfast-sign',
];

const requiredChecks = [
  {
    name: 'Canonical payment notify URL',
    file: 'src/config/commercePolicy.ts',
    includes: 'payfast-handler/notify',
  },
  {
    name: 'Canonical payment edge function',
    file: 'src/services/paymentService.ts',
    includes: 'invokeBackendFunction("payfast-handler"',
  },
  {
    name: 'Payment screen uses canonical notify URL helper',
    file: 'src/screens/PaymentScreen.tsx',
    includes: 'getDefaultPayfastNotifyUrl()',
  },
];

const forbiddenContentChecks = [
  {
    name: 'No legacy PayFast ITN route in app code',
    files: [
      'src/screens/PaymentScreen.tsx',
      'src/services/paymentService.ts',
      'src/services/monetisationService.ts',
      'src/screens/CreditsWalletScreen.tsx',
      'src/screens/PaidVideoCallScreen.tsx',
      'src/screens/UserProfileScreen.tsx',
    ],
    pattern: 'functions/v1/payfast-itn',
  },
];

const results = [];
const push = (name, ok, details = '') => results.push({ name, ok, details });

for (const rel of forbiddenPaths) {
  const abs = path.join(root, rel);
  push(`Forbidden legacy path absent: ${rel}`, !fs.existsSync(abs), fs.existsSync(abs) ? 'present' : 'absent');
}

for (const check of requiredChecks) {
  const abs = path.join(root, check.file);
  if (!fs.existsSync(abs)) {
    push(check.name, false, `missing file: ${check.file}`);
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  push(check.name, text.includes(check.includes), text.includes(check.includes) ? 'ok' : `missing "${check.includes}"`);
}

for (const check of forbiddenContentChecks) {
  let violation = null;
  for (const rel of check.files) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    if (text.includes(check.pattern)) {
      violation = rel;
      break;
    }
  }
  push(check.name, !violation, violation ? `found in ${violation}` : 'ok');
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ summary: { total: results.length, failed: failed.length }, results }, null, 2));
if (failed.length > 0) process.exit(1);
