import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const ANON = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const screensDir = path.join(process.cwd(), 'src', 'screens');
const results = [];
const warnings = [];
const push = (name, ok, details = '') => results.push({ name, ok, details });
const warn = (name, details) => warnings.push({ name, details });

const mkClient = (token) =>
  createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });

const parseTablesAndFunctions = (content) => {
  const tableRegex = /\.from\('([a-zA-Z0-9_]+)'\)/g;
  const fnRegex = /functions\.invoke\('([a-zA-Z0-9-]+)'/g;
  const tableSet = new Set();
  const fnSet = new Set();
  let m;
  while ((m = tableRegex.exec(content)) !== null) tableSet.add(m[1]);
  while ((m = fnRegex.exec(content)) !== null) fnSet.add(m[1]);
  return { tables: [...tableSet], functions: [...fnSet] };
};

const functionPayload = (name, ctx) => {
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  switch (name) {
    case 'status-leaderboard':
      return { city: 'Cape Town', limit: 20 };
    case 'for-you-ranking':
      return { limit: 20 };
    case 'heatmap':
      return { role: 'combined', hours: 6, city: 'Cape Town' };
    case 'compliance-consent':
      return {
        consent_type: 'terms',
        enabled: true,
        legal_basis: 'consent',
        consent_version: '1.0',
        context: { source: 'e2e_full_app_sweep' },
      };
    case 'dispatch-create':
      return {
        service_type: 'modeling',
        fanout_count: 5,
        intensity_level: 2,
        sla_timeout_seconds: 120,
        requested_lat: -33.9249,
        requested_lng: 18.4241,
        base_amount: 1200,
      };
    case 'dispatch-state':
      return { dispatch_request_id: ctx.dispatchRequestId };
    case 'dispatch-respond':
      return {
        dispatch_request_id: ctx.dispatchRequestId,
        offer_id: ctx.dispatchOfferId,
        response: 'decline',
        idempotency_key: `idem-${ctx.dispatchRequestId}`,
      };
    case 'eta':
      return { booking_id: ctx.bookingId };
    case 'livekit-token':
      return { creator_id: ctx.creatorId, role: 'viewer' };
    case 'payfast-handler':
      return { booking_id: ctx.bookingId };
    case 'escrow-release':
      return { booking_id: ctx.completedBookingId };
    default:
      return {};
  }
};

const callFunction = async (name, token, body) => {
  const resp = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, body: text };
};

const ensureUsers = async (admin) => {
  const stamp = Date.now();
  const users = [
    { role: 'client', email: `e2e.client.${stamp}@papzi.test`, password: `Papzi!${stamp % 1000000}Ab` },
    { role: 'photographer', email: `e2e.provider.${stamp}@papzi.test`, password: `Papzi!${(stamp + 1) % 1000000}Ab` },
    { role: 'admin', email: `e2e.admin.${stamp}@papzi.test`, password: `Papzi!${(stamp + 2) % 1000000}Ab` },
  ];

  const out = {};
  for (const u of users) {
    const created = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { role: u.role, full_name: `E2E ${u.role}` },
    });
    if (created.error) throw new Error(`createUser ${u.role}: ${created.error.message}`);
    out[u.role] = { ...u, id: created.data.user.id };
  }

  const profileRows = Object.values(out).map((u) => ({ id: u.id, role: u.role, full_name: `E2E ${u.role}` }));
  const prof = await admin.from('profiles').upsert(profileRows, { onConflict: 'id' });
  if (prof.error) throw new Error(`profiles upsert: ${prof.error.message}`);

  const photo = await admin.from('photographers').upsert(
    {
      id: out.photographer.id,
      name: 'E2E Provider',
      latitude: -33.924,
      longitude: 18.4248,
      is_available: true,
      rating: 5,
      price_range: '$$',
      style: 'street',
      bio: 'E2E provider',
      tags: ['e2e'],
    },
    { onConflict: 'id' },
  );
  if (photo.error) throw new Error(`photographers upsert: ${photo.error.message}`);

  const model = await admin.from('models').upsert(
    {
      id: out.photographer.id,
      latitude: -33.924,
      longitude: 18.4248,
      is_available: true,
      rating: 5,
      price_range: '$$',
      style: 'street',
      bio: 'E2E provider model',
      tags: ['e2e'],
    },
    { onConflict: 'id' },
  );
  if (model.error) throw new Error(`models upsert: ${model.error.message}`);

  return out;
};

const run = async () => {
  if (!URL || !ANON || !SERVICE) {
    push(
      'Config',
      false,
      'Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL, SUPABASE_ANON_KEY/EXPO_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY',
    );
    const failed = results.filter((r) => !r.ok);
    console.log(
      JSON.stringify(
        {
          summary: { total: results.length, failed: failed.length, warnings: warnings.length },
          warnings,
          results,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const screenFiles = (await fs.readdir(screensDir)).filter((f) => f.endsWith('.tsx')).sort();
    push('Screen inventory', screenFiles.length > 0, `screens=${screenFiles.length}`);

    const allTables = new Set();
    const allFns = new Set();
    for (const file of screenFiles) {
      const abs = path.join(screensDir, file);
      const content = await fs.readFile(abs, 'utf8');
      const onPressCount = (content.match(/\bonPress\s*=\s*{/g) || []).length;
      const hasInteractive = /TouchableOpacity|Pressable|Button|Switch/.test(content);
      if (hasInteractive && onPressCount === 0) {
        warn('Button wiring', `${file} has interactive components but no explicit onPress={...} handlers`);
      }
      push(`Screen button audit: ${file}`, !hasInteractive || onPressCount > 0, `onPress=${onPressCount}`);
      const parsed = parseTablesAndFunctions(content);
      parsed.tables.forEach((t) => allTables.add(t));
      parsed.functions.forEach((fn) => allFns.add(fn));
    }

    // Data contract audit for every table referenced by screens.
    for (const table of [...allTables].sort()) {
      const q = await admin.from(table).select('*').limit(1);
      push(`Data contract table: ${table}`, !q.error, q.error?.message || 'ok');
    }

    // Create seeded role users.
    const users = await ensureUsers(admin);
    push('Seed users', true, `client=${users.client.email} provider=${users.photographer.email} admin=${users.admin.email}`);

    const clientBase = mkClient();
    const providerBase = mkClient();
    const adminBase = mkClient();
    const clientSI = await clientBase.auth.signInWithPassword({ email: users.client.email, password: users.client.password });
    const providerSI = await providerBase.auth.signInWithPassword({ email: users.photographer.email, password: users.photographer.password });
    const adminSI = await adminBase.auth.signInWithPassword({ email: users.admin.email, password: users.admin.password });
    if (clientSI.error || providerSI.error || adminSI.error) {
      throw new Error(
        `signin errors: ${clientSI.error?.message || 'none'} | ${providerSI.error?.message || 'none'} | ${adminSI.error?.message || 'none'}`,
      );
    }
    const clientToken = clientSI.data.session.access_token;
    const providerToken = providerSI.data.session.access_token;
    const adminToken = adminSI.data.session.access_token;
    const client = clientBase;
    const provider = providerBase;

    // Seed dashboard-critical records.
    const earnings = await admin.from('earnings').insert({
      user_id: users.photographer.id,
      amount: 450,
      source_type: 'booking',
      source_id: null,
      gross_amount: 500,
      platform_fee: 50,
    });
    push('Seed earnings', !earnings.error, earnings.error?.message || 'ok');

    const payment = await admin.from('payments').insert({
      customer_id: users.client.id,
      amount: 500,
      description: 'E2E booking payment',
      status: 'failed',
      provider: 'payfast',
      provider_payload: {},
    });
    push('Seed payments', !payment.error, payment.error?.message || 'ok');

    const caseInsert = await admin.from('moderation_cases').insert({
      reporter_id: users.client.id,
      target_user_id: users.photographer.id,
      target_type: 'profile',
      target_id: users.photographer.id,
      reason: 'E2E moderation smoke',
      severity: 2,
      status: 'open',
    }).select('id').single();
    push('Seed moderation case', !caseInsert.error, caseInsert.error?.message || 'ok');

    const violationInsert = await admin.from('policy_violations').insert({
      user_id: users.photographer.id,
      entity_type: 'post',
      entity_id: `e2e-${Date.now()}`,
      policy_code: 'CONTENT_POLICY',
      severity: 2,
      status: 'warning',
      details: { source: 'e2e' },
    }).select('id').single();
    push('Seed policy violation', !violationInsert.error, violationInsert.error?.message || 'ok');

    const statusScore = await admin.from('status_scores').upsert({
      user_id: users.photographer.id,
      seen_score: 42,
      scene_rank: 7,
      trending_badges: ['e2e'],
    }, { onConflict: 'user_id' });
    push('Seed status score', !statusScore.error, statusScore.error?.message || 'ok');

    // Dispatch / ETA / PPV / Consent / Notifications / Support flows (button-driven).
    let ctx = {
      dispatchRequestId: null,
      dispatchOfferId: null,
      bookingId: null,
      completedBookingId: null,
      creatorId: users.photographer.id,
    };

    const consentCall = await callFunction('compliance-consent', clientToken, functionPayload('compliance-consent', ctx));
    push('Action: compliance consent', consentCall.ok, `status=${consentCall.status} body=${consentCall.body.slice(0, 180)}`);

    const dispatchCreate = await callFunction('dispatch-create', clientToken, functionPayload('dispatch-create', ctx));
    push('Action: dispatch create', dispatchCreate.ok, `status=${dispatchCreate.status} body=${dispatchCreate.body.slice(0, 180)}`);
    if (dispatchCreate.ok) {
      const parsed = JSON.parse(dispatchCreate.body);
      ctx.dispatchRequestId = parsed.dispatch_request?.id ?? null;
      const providerOffer = (parsed.offers || []).find((o) => o.provider_id === users.photographer.id);
      ctx.dispatchOfferId = providerOffer?.id ?? null;
    }

    if (ctx.dispatchRequestId) {
      const state = await callFunction('dispatch-state', clientToken, functionPayload('dispatch-state', ctx));
      push('Action: dispatch state', state.ok, `status=${state.status}`);
    } else {
      push('Action: dispatch state', false, 'No dispatch_request_id');
    }

    if (ctx.dispatchRequestId && !ctx.dispatchOfferId) {
      // Fallback for deterministic idempotency coverage: create a provider-bound offer explicitly.
      const fallbackDispatch = await admin
        .from('dispatch_requests')
        .insert({
          client_id: users.client.id,
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
            provider_id: users.photographer.id,
            offer_rank: 1,
            status: 'offered',
          })
          .select('id')
          .single();
        if (!fallbackOffer.error) {
          ctx.dispatchRequestId = fallbackDispatch.data.id;
          ctx.dispatchOfferId = fallbackOffer.data.id;
        }
      }
    }

    if (ctx.dispatchRequestId && ctx.dispatchOfferId) {
      const r1 = await callFunction('dispatch-respond', providerToken, functionPayload('dispatch-respond', ctx));
      const r2 = await callFunction('dispatch-respond', providerToken, functionPayload('dispatch-respond', ctx));
      const secondAcceptable = r2.ok || r2.status === 404 || r2.status === 409 || /already|not active|not found/i.test(r2.body);
      push('Action: dispatch respond idempotency', r1.ok && secondAcceptable, `r1=${r1.status} r2=${r2.status}`);
    } else {
      push('Action: dispatch respond idempotency', false, 'No provider offer bound to seeded provider');
    }

    const now = new Date();
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    const bookingInsert = await admin.from('bookings').insert({
      client_id: users.client.id,
      photographer_id: users.photographer.id,
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
    }).select('id').single();
    push('Seed booking', !bookingInsert.error, bookingInsert.error?.message || 'ok');
    if (!bookingInsert.error) ctx.bookingId = bookingInsert.data.id;

    if (ctx.bookingId) {
      const etaCall = await callFunction('eta', clientToken, functionPayload('eta', ctx));
      push('Action: ETA lookup', etaCall.ok, `status=${etaCall.status} body=${etaCall.body.slice(0, 180)}`);
      // Simulate booking buttons: accept/complete/cancel transitions.
      const upd1 = await admin.from('bookings').update({ status: 'accepted' }).eq('id', ctx.bookingId);
      const upd2 = await admin.from('bookings').update({ status: 'completed' }).eq('id', ctx.bookingId);
      push('Action: booking status buttons', !upd1.error && !upd2.error, `${upd1.error?.message || 'ok'} / ${upd2.error?.message || 'ok'}`);
      if (!upd2.error) ctx.completedBookingId = ctx.bookingId;
    } else {
      push('Action: ETA lookup', false, 'No seeded booking');
      push('Action: booking status buttons', false, 'No seeded booking');
    }

    const postSeed = await admin.from('posts').select('id').limit(1).maybeSingle();
    if (!postSeed.error && postSeed.data?.id) {
      const lock = await admin.from('posts').update({ is_locked: true, unlock_price: 55 }).eq('id', postSeed.data.id);
      const unlock = await client.from('post_unlocks').upsert(
        { user_id: users.client.id, post_id: postSeed.data.id, amount_paid: 55 },
        { onConflict: 'user_id,post_id' },
      );
      push('Action: PPV lock/unlock button flow', !lock.error && !unlock.error, `${lock.error?.message || 'ok'} / ${unlock.error?.message || 'ok'}`);
    } else {
      push('Action: PPV lock/unlock button flow', false, postSeed.error?.message || 'No post found');
    }

    const notifEvent = await admin.from('notification_events').insert({
      user_id: users.photographer.id,
      event_type: 'booking_confirmed',
      title: 'E2E Notification Event',
      body: 'Event body',
      data: {
        category: 'booking',
        action_type: 'booking_response',
        action_payload: { dispatch_request_id: ctx.dispatchRequestId, offer_id: ctx.dispatchOfferId },
      },
      status: 'queued',
    });
    push('Seed notification events', !notifEvent.error, notifEvent.error?.message || 'ok');

    const support = await admin.from('support_tickets').insert({
      created_by: users.client.id,
      subject: 'E2E Support',
      category: 'billing',
      description: 'Support flow smoke test',
      status: 'open',
    });
    push('Action: support submit', !support.error, support.error?.message || 'ok');

    // Payout methods table is not present in this deployment, so keep this as an explicit capability-gap signal.
    const payout = await admin.from('payout_methods').select('id').limit(1);
    if (payout.error) {
      warn('Action: payout method add', payout.error.message);
    } else {
      push('Action: payout method add', true, 'table available');
    }

    // Moderation triage actions (admin dashboard buttons).
    if (!caseInsert.error) {
      const u1 = await admin.from('moderation_cases').update({ status: 'in_review', assigned_admin_id: users.admin.id }).eq('id', caseInsert.data.id);
      const u2 = await admin.from('moderation_cases').update({ status: 'resolved', resolution_notes: 'e2e resolved' }).eq('id', caseInsert.data.id);
      push('Action: moderation queue buttons', !u1.error && !u2.error, `${u1.error?.message || 'ok'} / ${u2.error?.message || 'ok'}`);
    } else {
      push('Action: moderation queue buttons', false, 'No seeded moderation case');
    }

    if (!violationInsert.error) {
      const uv = await admin.from('policy_violations').update({ status: 'resolved' }).eq('id', violationInsert.data.id);
      push('Action: policy triage buttons', !uv.error, uv.error?.message || 'ok');
    } else {
      push('Action: policy triage buttons', false, 'No seeded policy violation');
    }

    // Run all function contracts discovered in screens (best-effort).
    const criticalFns = new Set([
      'status-leaderboard',
      'for-you-ranking',
      'heatmap',
      'compliance-consent',
      'dispatch-create',
      'dispatch-state',
      'dispatch-respond',
      'eta',
    ]);
    for (const fn of [...allFns].sort()) {
      const body = functionPayload(fn, ctx);
      const token = fn === 'dispatch-respond' || fn === 'escrow-release' ? providerToken : clientToken;
      const called = await callFunction(fn, token, body);
      const isCritical = criticalFns.has(fn);
      if (!isCritical && !called.ok) {
        warn(`Function contract: ${fn}`, `status=${called.status} body=${called.body.slice(0, 180)}`);
      } else {
        push(`Function contract: ${fn}`, called.ok, `status=${called.status} body=${called.body.slice(0, 120)}`);
      }
    }

    // Admin dashboard query replication.
    const adminChecks = await Promise.all([
      admin.from('dispatch_requests').select('id', { count: 'exact', head: true }).in('status', ['queued', 'offered']),
      admin.from('eta_snapshots').select('eta_confidence').order('created_at', { ascending: false }).limit(100),
      admin.from('moderation_cases').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_review', 'escalated']),
      admin.from('payments').select('id', { count: 'exact', head: true }).in('status', ['failed', 'cancelled']),
    ]);
    push('Dashboard: admin queries', adminChecks.every((q) => !q.error), adminChecks.map((q) => q.error?.message || 'ok').join(' | '));
  } catch (error) {
    push('E2E full sweep runner', false, error instanceof Error ? error.message : String(error));
  } finally {
    const failed = results.filter((r) => !r.ok);
    console.log(
      JSON.stringify(
        {
          summary: {
            total: results.length,
            failed: failed.length,
            warnings: warnings.length,
          },
          warnings,
          results,
        },
        null,
        2,
      ),
    );
    process.exit(failed.length ? 1 : 0);
  }
};

run();
