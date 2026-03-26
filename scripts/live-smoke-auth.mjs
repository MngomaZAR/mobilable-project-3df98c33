import { createClient } from '@supabase/supabase-js';
import { loadLocalEnv } from './lib/load-env-file.mjs';

loadLocalEnv();

const URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const ANON = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const results = [];
const push = (name, ok, details = '') => results.push({ name, ok, details });
const describeError = (error) => {
  if (!error) return 'ok';
  try {
    return JSON.stringify(
      {
        message: error.message,
        name: error.name,
        status: error.status ?? null,
        context: error.context ?? null,
      },
      null,
      0,
    );
  } catch {
    return String(error);
  }
};
const decodeJwtPart = (jwt, index) => {
  try {
    const part = jwt.split('.')[index] || '';
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

const callFunctionDirect = async (name, body, token) => {
  const response = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  return { status: response.status, body: text };
};

const mkClient = (token) =>
  createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });

const run = async () => {
  if (!URL || !ANON || !SERVICE) {
    push(
      'Config',
      false,
      'Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL, SUPABASE_ANON_KEY/EXPO_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY',
    );
    const failed = results.filter((r) => !r.ok);
    console.log(JSON.stringify({ summary: { total: results.length, failed: failed.length }, results }, null, 2));
    process.exit(1);
  }
  const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const suffix = Date.now();
    const clientEmail = `smoke.client.${suffix}@papzi.test`;
    const clientPassword = `Papzi!${Math.floor(Math.random() * 900000 + 100000)}Ab`;
    const providerEmail = `smoke.provider.${suffix}@papzi.test`;
    const providerPassword = `Papzi!${Math.floor(Math.random() * 900000 + 100000)}Ab`;

    const clientUserRes = await admin.auth.admin.createUser({
      email: clientEmail,
      password: clientPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Smoke Client', role: 'client' },
    });
    const providerUserRes = await admin.auth.admin.createUser({
      email: providerEmail,
      password: providerPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Smoke Provider', role: 'photographer' },
    });

    if (clientUserRes.error || providerUserRes.error) {
      throw new Error(
        `createUser failed: ${clientUserRes.error?.message || ''} ${providerUserRes.error?.message || ''}`.trim(),
      );
    }

    const clientUserId = clientUserRes.data.user.id;
    const providerUserId = providerUserRes.data.user.id;

    await admin.from('profiles').upsert(
      [
        { id: clientUserId, full_name: 'Smoke Client', role: 'client' },
        { id: providerUserId, full_name: 'Smoke Provider', role: 'photographer' },
      ],
      { onConflict: 'id' },
    );

    const { error: photographerErr } = await admin.from('photographers').upsert(
      {
        id: providerUserId,
        name: 'Smoke Provider',
        latitude: -33.924,
        longitude: 18.4248,
        is_available: true,
        rating: 5,
        price_range: '$$',
        style: 'street',
        bio: 'Smoke provider',
        tags: ['smoke'],
      },
      { onConflict: 'id' },
    );
    push('Setup provider profile', !photographerErr, photographerErr?.message || 'ok');
    const { error: modelErr } = await admin.from('models').upsert(
      {
        id: providerUserId,
        latitude: -33.924,
        longitude: 18.4248,
        is_available: true,
        rating: 5,
        price_range: '$$',
        style: 'street',
        bio: 'Smoke provider model',
        tags: ['smoke'],
      },
      { onConflict: 'id' },
    );
    push('Setup provider model', !modelErr, modelErr?.message || 'ok');

    const clientAuthClient = mkClient();
    const providerAuthClient = mkClient();
    const clientSignIn = await clientAuthClient.auth.signInWithPassword({ email: clientEmail, password: clientPassword });
    const providerSignIn = await providerAuthClient.auth.signInWithPassword({ email: providerEmail, password: providerPassword });
    if (clientSignIn.error || providerSignIn.error) {
      throw new Error(`signIn failed: ${clientSignIn.error?.message || ''} ${providerSignIn.error?.message || ''}`.trim());
    }
    if (!clientSignIn.data.session?.access_token || !providerSignIn.data.session?.access_token) {
      throw new Error('Sign in succeeded but no access token returned.');
    }

    const client = clientAuthClient;
    const provider = providerAuthClient;
    const clientToken = clientSignIn.data.session.access_token;
    push('Client JWT shape', clientToken.split('.').length === 3, `segments=${clientToken.split('.').length}`);
    const jwtHeader = decodeJwtPart(clientToken, 0);
    const jwtPayload = decodeJwtPart(clientToken, 1);
    push('Client JWT alg', Boolean(jwtHeader?.alg), `alg=${jwtHeader?.alg || 'unknown'} aud=${jwtPayload?.aud || 'n/a'}`);

    const consent = await client.functions.invoke('compliance-consent', {
      body: { consent_type: 'terms', enabled: true, legal_basis: 'consent', consent_version: '1.0', context: { source: 'live_smoke' } },
    });
    if (consent.error) {
      const probe = await callFunctionDirect(
        'compliance-consent',
        { consent_type: 'terms', enabled: true, legal_basis: 'consent', consent_version: '1.0', context: { source: 'live_smoke_probe' } },
        clientToken,
      );
      push('Consent event', false, `${describeError(consent.error)} / direct=${probe.status}:${probe.body}`);
    } else {
      push('Consent event', true, 'ok');
    }

    const dispatchCreate = await client.functions.invoke('dispatch-create', {
      body: {
        service_type: 'modeling',
        fanout_count: 5,
        intensity_level: 2,
        sla_timeout_seconds: 120,
        requested_lat: -33.9249,
        requested_lng: 18.4241,
        base_amount: 1200,
      },
    });
    if (dispatchCreate.error) {
      const probe = await callFunctionDirect(
        'dispatch-create',
        {
          service_type: 'modeling',
          fanout_count: 5,
          intensity_level: 2,
          sla_timeout_seconds: 120,
          requested_lat: -33.9249,
          requested_lng: 18.4241,
          base_amount: 1200,
        },
        clientToken,
      );
      push('Dispatch create', false, `${describeError(dispatchCreate.error)} / direct=${probe.status}:${probe.body}`);
    } else {
      push('Dispatch create', true, 'ok');
    }

    const dispatchId = dispatchCreate.data?.dispatch_request?.id ?? null;
    const state = dispatchId
      ? await client.functions.invoke('dispatch-state', { body: { dispatch_request_id: dispatchId } })
      : { error: { message: 'No dispatch id' }, data: null };
    push('Dispatch state', !state.error, describeError(state.error));

    const offerList = dispatchCreate.data?.offers ?? state.data?.offers ?? [];
    let offerId = offerList.find((offer) => offer.provider_id === providerUserId)?.id ?? null;
    let dispatchIdForRespond = dispatchId;

    // Fallback: create deterministic provider-bound request/offer when fanout excludes seeded provider.
    if (dispatchId && !offerId) {
      const fallbackDispatch = await admin
        .from('dispatch_requests')
        .insert({
          client_id: clientUserId,
          service_type: 'modeling',
          fanout_count: 1,
          intensity_level: 1,
          sla_timeout_seconds: 90,
          status: 'offered',
        })
        .select('id')
        .single();

      if (!fallbackDispatch.error) {
        const fallbackOffer = await admin
          .from('dispatch_offers')
          .insert({
            dispatch_request_id: fallbackDispatch.data.id,
            provider_id: providerUserId,
            offer_rank: 1,
            status: 'offered',
          })
          .select('id')
          .single();

        if (!fallbackOffer.error) {
          dispatchIdForRespond = fallbackDispatch.data.id;
          offerId = fallbackOffer.data.id;
        }
      }
    }

    if (dispatchIdForRespond && offerId) {
      const dec1 = await provider.functions.invoke('dispatch-respond', {
        body: { dispatch_request_id: dispatchIdForRespond, offer_id: offerId, response: 'decline', idempotency_key: `idem-${dispatchIdForRespond}` },
      });
      const dec2 = await provider.functions.invoke('dispatch-respond', {
        body: { dispatch_request_id: dispatchIdForRespond, offer_id: offerId, response: 'decline', idempotency_key: `idem-${dispatchIdForRespond}` },
      });
      let details = `${describeError(dec1.error)} / ${describeError(dec2.error)}`;
      if (dec1.error || dec2.error) {
        const probe1 = await callFunctionDirect(
          'dispatch-respond',
          { dispatch_request_id: dispatchIdForRespond, offer_id: offerId, response: 'decline', idempotency_key: `idem-${dispatchIdForRespond}` },
          providerSignIn.data.session.access_token,
        );
        const probe2 = await callFunctionDirect(
          'dispatch-respond',
          { dispatch_request_id: dispatchIdForRespond, offer_id: offerId, response: 'decline', idempotency_key: `idem-${dispatchIdForRespond}` },
          providerSignIn.data.session.access_token,
        );
        details += ` / direct=${probe1.status}:${probe1.body} || ${probe2.status}:${probe2.body}`;
      }
      const ok = !dec1.error && (!dec2.error || /not found|not active|already|single/i.test(dec2.error.message || ''));
      push('Dispatch idempotency', ok, details);
    } else {
      push('Dispatch idempotency', false, `No provider-specific offer returned. offer_count=${offerList.length}`);
    }

    const now = new Date();
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    const bookingInsert = await admin
      .from('bookings')
      .insert({
        client_id: clientUserId,
        photographer_id: providerUserId,
        status: 'pending',
        price_total: 1200,
        service_type: 'photography',
        user_latitude: -33.9252,
        user_longitude: 18.4234,
        start_datetime: now.toISOString(),
        end_datetime: later.toISOString(),
        assignment_state: 'accepted',
        fanout_count: 1,
        intensity_level: 1,
      })
      .select('id')
      .single();
    push('Seed booking for ETA', !bookingInsert.error, describeError(bookingInsert.error));

    if (!bookingInsert.error) {
      const eta = await client.functions.invoke('eta', { body: { booking_id: bookingInsert.data.id } });
      const etaConfidence = Number(eta.data?.eta_confidence ?? -1);
      const etaOk = !eta.error && etaConfidence >= 0 && etaConfidence <= 1;
      if (!etaOk) {
        const probe = await callFunctionDirect('eta', { booking_id: bookingInsert.data.id }, clientToken);
        push('ETA confidence', false, `${describeError(eta.error)} / direct=${probe.status}:${probe.body}`);
      } else {
        push('ETA confidence', true, `confidence=${etaConfidence}`);
      }
    } else {
      push('ETA confidence', false, 'booking seed failed');
    }

    const anyPost = await admin.from('posts').select('id').limit(1).maybeSingle();
    if (anyPost.error || !anyPost.data?.id) {
      push('PPV test setup', false, anyPost.error?.message || 'No post found');
    } else {
      const lockPost = await admin
        .from('posts')
        .update({ is_locked: true, unlock_price: 55 })
        .eq('id', anyPost.data.id)
        .select('id,is_locked,unlock_price')
        .single();
      push('PPV test setup', !lockPost.error, lockPost.error?.message || 'ok');
      if (!lockPost.error) {
        const unlock = await client
          .from('post_unlocks')
          .upsert({ user_id: clientUserId, post_id: lockPost.data.id, amount_paid: 55 }, { onConflict: 'user_id,post_id' });
        push('PPV unlock entitlement', !unlock.error, unlock.error?.message || 'ok');
      } else {
        push('PPV unlock entitlement', false, 'Could not lock a post for test');
      }
    }

    push('Smoke users', true, `${clientEmail} / ${providerEmail}`);
  } catch (error) {
    push('Smoke runner', false, error instanceof Error ? error.message : String(error));
  } finally {
    const failed = results.filter((r) => !r.ok);
    console.log(JSON.stringify({ summary: { total: results.length, failed: failed.length }, results }, null, 2));
    process.exit(failed.length > 0 ? 1 : 0);
  }
};

run();
