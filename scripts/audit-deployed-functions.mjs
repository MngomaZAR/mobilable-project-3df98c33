import { loadLocalEnv } from './lib/load-env-file.mjs';

loadLocalEnv();

const projectRef = (process.env.SUPABASE_PROJECT_REF || 'mizdvqhvspkjayffaqqd').trim();
const accessToken = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();

const legacyFunctions = ['payfast-itn', 'payfast-sign'];
const requiredFunctions = [
  'admin-review',
  'chat-messages',
  'compliance-consent',
  'conversation-start',
  'dispatch-create',
  'dispatch-respond',
  'dispatch-state',
  'escrow-release',
  'eta',
  'for-you-ranking',
  'heatmap',
  'livekit-token',
  'payfast-handler',
  'payout-methods',
  'recommendation-events',
  'send-app-email',
  'status-leaderboard',
];

const results = [];
const push = (name, ok, details = '') => results.push({ name, ok, details });

if (!accessToken) {
  push(
    'Supabase management access token',
    false,
    'Missing SUPABASE_ACCESS_TOKEN. Set it to audit deployed functions in the live project.',
  );
} else {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/functions`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    push('Supabase management API call', false, `status=${response.status} body=${body.slice(0, 180)}`);
  } else {
    const data = await response.json();
    const functions = Array.isArray(data) ? data : data?.functions ?? [];
    const slugs = new Set(functions.map((item) => item?.slug).filter(Boolean));

    push('Deployed functions listed', true, `count=${slugs.size}`);

    for (const slug of requiredFunctions) {
      push(`Required function deployed: ${slug}`, slugs.has(slug), slugs.has(slug) ? 'ok' : 'missing');
    }

    for (const slug of legacyFunctions) {
      push(`Legacy function absent: ${slug}`, !slugs.has(slug), slugs.has(slug) ? 'present' : 'absent');
    }
  }
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ summary: { total: results.length, failed: failed.length }, results }, null, 2));
if (failed.length > 0) process.exit(1);
