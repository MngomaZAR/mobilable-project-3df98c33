import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mizdvqhvspkjayffaqqd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pemR2cWh2c3BramF5ZmZhcXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNjg0NzksImV4cCI6MjA4Mjk0NDQ3OX0.WBEcxhd0WFpay_J9l2_A1wpfkbpcIUiAQnp1VeMvNjY';

const results = [];
const push = (name, ok, details = '') => results.push({ name, ok, details });
const TEST_ACCESS_TOKEN = process.env.SUPABASE_TEST_ACCESS_TOKEN || '';
const TEST_EMAIL = process.env.SUPABASE_TEST_EMAIL || '';
const TEST_PASSWORD = process.env.SUPABASE_TEST_PASSWORD || '';


const publicClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tokenClient = TEST_ACCESS_TOKEN
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` } },
    })
  : publicClient;

const run = async () => {
  try {
    // Public endpoint smoke (no auth required by current function logic)
    const publicBoard = await publicClient.functions.invoke('status-leaderboard', { body: { city: 'Cape Town', limit: 20 } });
    push('Public status-leaderboard', !publicBoard.error, publicBoard.error?.message || 'ok');
    const publicRanking = await publicClient.functions.invoke('for-you-ranking', { body: { limit: 20 } });
    push('Public for-you-ranking', !publicRanking.error, publicRanking.error?.message || 'ok');
    const publicHeatmap = await publicClient.functions.invoke('heatmap', { body: { role: 'combined', hours: 6, city: 'Cape Town' } });
    push('Public heatmap', !publicHeatmap.error, publicHeatmap.error?.message || 'ok');

    let authReady = false;
    let activeAuthClient = tokenClient;
    let activeToken = TEST_ACCESS_TOKEN;
    if (TEST_ACCESS_TOKEN) {
      const userCheck = await tokenClient.auth.getUser(TEST_ACCESS_TOKEN);
      if (userCheck.error || !userCheck.data?.user?.id) {
        push('Auth provided token', false, userCheck.error?.message || 'Invalid token');
      } else {
        push('Auth provided token', true, userCheck.data.user.email || userCheck.data.user.id);
        authReady = true;
      }
    } else if (TEST_EMAIL && TEST_PASSWORD) {
      const signIn = await publicClient.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
      if (signIn.error || !signIn.data.session?.access_token) {
        push('Auth test account sign-in', false, signIn.error?.message || 'No session');
      } else {
        const sessionToken = signIn.data.session.access_token;
        const signedInClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${sessionToken}` } },
        });
        push('Auth test account sign-in', true, TEST_EMAIL);
        authReady = true;
        activeAuthClient = signedInClient;
        activeToken = sessionToken;
      }
    } else {
      push(
        'Auth setup',
        false,
        'Set SUPABASE_TEST_ACCESS_TOKEN or SUPABASE_TEST_EMAIL + SUPABASE_TEST_PASSWORD. Script no longer auto-signs up disposable emails.',
      );
    }

    if (!authReady) {
      push('Auth-required smoke tests', false, 'Not authenticated; provide SUPABASE_TEST_ACCESS_TOKEN for full dispatch/ETA/PPV flow tests.');
      return;
    }

    const consent = await activeAuthClient.functions.invoke('compliance-consent', {
      body: {
        consent_type: 'terms',
        enabled: true,
        legal_basis: 'consent',
        consent_version: '1.0',
        context: { source: 'smoke_test' },
      },
    });
    push('Compliance consent invoke', !consent.error, consent.error?.message || 'ok');

    const dispatchCreate = await activeAuthClient.functions.invoke('dispatch-create', {
      body: {
        service_type: 'photography',
        fanout_count: 2,
        intensity_level: 2,
        sla_timeout_seconds: 90,
        requested_lat: -33.9249,
        requested_lng: 18.4241,
        base_amount: 1200,
      },
    });
    push('Dispatch create', !dispatchCreate.error, dispatchCreate.error?.message || 'ok');

    const dispatchId = dispatchCreate.data?.dispatch_request?.id;
    if (dispatchId) {
      const dispatchState = await activeAuthClient.functions.invoke('dispatch-state', { body: { dispatch_request_id: dispatchId } });
      push('Dispatch state', !dispatchState.error, dispatchState.error?.message || 'ok');

      // idempotency behavior: same decline twice should not crash API
      const firstOffer = dispatchState.data?.offers?.[0];
      if (firstOffer) {
        const dec1 = await activeAuthClient.functions.invoke('dispatch-respond', {
          body: { dispatch_request_id: dispatchId, offer_id: firstOffer.id, response: 'decline', idempotency_key: `k-${dispatchId}` },
        });
        const dec2 = await activeAuthClient.functions.invoke('dispatch-respond', {
          body: { dispatch_request_id: dispatchId, offer_id: firstOffer.id, response: 'decline', idempotency_key: `k-${dispatchId}` },
        });
        const ok = !dec1.error && (!dec2.error || /not found|not active|already/i.test(dec2.error.message || ''));
        push('Dispatch idempotency (decline retry)', ok, `${dec1.error?.message || 'ok'} / ${dec2.error?.message || 'ok'}`);
      } else {
        push('Dispatch idempotency (decline retry)', false, 'No offer returned for provider response test');
      }
    }

    const statusBoard = await activeAuthClient.functions.invoke('status-leaderboard', { body: { city: 'Cape Town', limit: 20 } });
    push('Status leaderboard', !statusBoard.error, statusBoard.error?.message || 'ok');

    const forYou = await activeAuthClient.functions.invoke('for-you-ranking', { body: { limit: 20 } });
    push('For You ranking', !forYou.error, forYou.error?.message || 'ok');

    const heatmap = await activeAuthClient.functions.invoke('heatmap', { body: { role: 'combined', hours: 6, city: 'Cape Town' } });
    push('Heatmap endpoint', !heatmap.error, heatmap.error?.message || 'ok');

    // PPV entitlement smoke: create unlock row for an existing locked post if one exists.
    const lockedPost = await activeAuthClient.from('posts').select('id,author_id,is_locked,unlock_price').eq('is_locked', true).limit(1).maybeSingle();
    if (!lockedPost.error && lockedPost.data?.id) {
      const { data: userData } = await activeAuthClient.auth.getUser(activeToken || undefined);
      const unlockRes = await activeAuthClient.from('post_unlocks').upsert(
        { user_id: userData.user?.id, post_id: lockedPost.data.id, amount_paid: Number(lockedPost.data.unlock_price || 0) },
        { onConflict: 'user_id,post_id' }
      );
      push('PPV unlock entitlement upsert', !unlockRes.error, unlockRes.error?.message || 'ok');
    } else {
      push('PPV unlock entitlement upsert', false, 'No locked post found for test');
    }

    // ETA sanity: try on latest booking for this user if available.
    const myBooking = await activeAuthClient.from('bookings').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (myBooking.data?.id) {
      const eta = await activeAuthClient.functions.invoke('eta', { body: { booking_id: myBooking.data.id } });
      push('ETA endpoint', !eta.error, eta.error?.message || 'ok');
    } else {
      push('ETA endpoint', false, 'No booking found for ETA smoke');
    }
  } catch (err) {
    push('Smoke test runner', false, err instanceof Error ? err.message : String(err));
  } finally {
    const failed = results.filter((r) => !r.ok);
    console.log(JSON.stringify({ summary: { total: results.length, failed: failed.length }, results }, null, 2));
    process.exit(failed.length > 0 ? 1 : 0);
  }
};

run();
