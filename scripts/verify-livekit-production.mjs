import { createClient } from '@supabase/supabase-js';
import { loadLocalEnv } from './lib/load-env-file.mjs';

loadLocalEnv();

const URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error(JSON.stringify({
    ok: false,
    error: 'Missing SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY (or EXPO_PUBLIC variants).',
  }, null, 2));
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const client = createClient(URL, ANON, { auth: { persistSession: false } });

const now = Date.now();
const viewerEmail = `livekit.client.${now}@papzi.test`;
const password = `Papzi!${String(now).slice(-6)}Aa`;

const cleanupIds = [];

const removeUsers = async () => {
  for (const id of cleanupIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // ignore cleanup errors
    }
  }
};

try {
  // 1) Secret presence check without auth (function checks secrets before auth).
  const secretProbe = await fetch(`${URL}/functions/v1/livekit-token`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ creator_id: 'probe', role: 'viewer' }),
  });
  const secretProbeText = await secretProbe.text();
  const secretProbeBody = (() => {
    try { return JSON.parse(secretProbeText); } catch { return { raw: secretProbeText }; }
  })();

  if (secretProbe.status === 500 && String(secretProbeText).toLowerCase().includes('livekit credentials not configured')) {
    console.error(JSON.stringify({
      ok: false,
      phase: 'secret_probe',
      status: secretProbe.status,
      body: secretProbeBody,
    }, null, 2));
    process.exit(1);
  }

  // 2) Resolve an existing model profile from production.
  const modelLookup = await admin
    .from('profiles')
    .select('id, role')
    .eq('role', 'model')
    .limit(1)
    .maybeSingle();
  if (modelLookup.error) throw modelLookup.error;
  if (!modelLookup.data?.id) throw new Error('No model profile found in production to validate LiveKit flow.');

  // 3) Create a fresh client user.
  const viewerRes = await admin.auth.admin.createUser({
    email: viewerEmail,
    password,
    email_confirm: true,
    app_metadata: { role: 'client' },
    user_metadata: { full_name: 'LiveKit Client Smoke' },
  });
  if (viewerRes.error || !viewerRes.data.user) throw viewerRes.error || new Error('client create failed');
  cleanupIds.push(viewerRes.data.user.id);

  const modelId = modelLookup.data.id;
  const viewerId = viewerRes.data.user.id;

  // Give trigger propagation a short window, then verify viewer role explicitly.
  let resolvedRoles = null;
  for (let i = 0; i < 5; i += 1) {
    const roleCheck = await admin
      .from('profiles')
      .select('id, role')
      .in('id', [viewerId, modelId]);
    if (roleCheck.error) throw roleCheck.error;
    const map = Object.fromEntries((roleCheck.data ?? []).map((r) => [r.id, r.role]));
    if (map[modelId] === 'model' && map[viewerId] === 'client') {
      resolvedRoles = map;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!resolvedRoles) {
    throw new Error('Failed to resolve expected roles for livekit verification users (client/model).');
  }

  // Ensure viewer has enough credits for hold.
  const walletSeed = await admin
    .from('credits_wallets')
    .upsert({ user_id: viewerId, balance: 100 }, { onConflict: 'user_id' });
  if (walletSeed.error) throw walletSeed.error;

  // 4) Sign in as client and call livekit-token in valid flow.
  const signIn = await client.auth.signInWithPassword({ email: viewerEmail, password });
  if (signIn.error || !signIn.data.session?.access_token) throw signIn.error || new Error('sign in failed');
  const accessToken = signIn.data.session.access_token;

  const livekitCall = await fetch(`${URL}/functions/v1/livekit-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ creator_id: modelId, role: 'viewer' }),
  });
  const livekitText = await livekitCall.text();
  const livekitBody = (() => {
    try { return JSON.parse(livekitText); } catch { return { raw: livekitText }; }
  })();

  const livekitUrl = String(livekitBody?.url || '');
  const hasToken = Boolean(livekitBody?.token && String(livekitBody.token).split('.').length === 3);
  const hasConfiguredUrl = livekitUrl.length > 0 && !livekitUrl.includes('your-livekit-server.livekit.cloud');

  const ok = livekitCall.status === 200 && hasToken && hasConfiguredUrl;

  console.log(JSON.stringify({
    ok,
    secretProbe: {
      status: secretProbe.status,
      body: secretProbeBody,
    },
    livekitCall: {
      status: livekitCall.status,
      hasToken,
      url: livekitUrl || null,
      hasConfiguredUrl,
      response: livekitBody,
    },
    verifiedRoles: resolvedRoles,
  }, null, 2));

  if (!ok) process.exit(1);
} catch (error) {
  const details = (() => {
    if (!error) return null;
    if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
    try { return JSON.parse(JSON.stringify(error)); } catch { return String(error); }
  })();
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    details,
  }, null, 2));
  process.exit(1);
} finally {
  await removeUsers();
}
