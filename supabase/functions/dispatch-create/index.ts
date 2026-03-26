import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json; charset=utf-8',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const asInt = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const toArray = (value: unknown) =>
  Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];

const normalizeEquipment = (value: any) => ({
  camera: toArray(value?.camera),
  lenses: toArray(value?.lenses),
  lighting: toArray(value?.lighting),
  extras: toArray(value?.extras),
});

const equipmentMatches = (provider: any, required: any) => {
  if (!required) return true;
  const providerEq = normalizeEquipment(provider ?? {});
  const requiredEq = normalizeEquipment(required ?? {});
  const categories: Array<keyof typeof requiredEq> = ['camera', 'lenses', 'lighting', 'extras'];
  return categories.every((category) => {
    const needed = requiredEq[category];
    if (!needed.length) return true;
    const available = providerEq[category] ?? [];
    return needed.every((item: string) => available.includes(item));
  });
};

const isOnlineStatus = (value: unknown) =>
  ['online', 'available', 'active'].includes(String(value ?? '').toLowerCase());

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRole) return json(500, { error: 'Missing Supabase env.' });

    const admin = createClient(supabaseUrl, serviceRole);
    const auth = req.headers.get('Authorization');
    const body = await req.json().catch(() => null) as any;
    const tokenFromHeader = auth ? auth.replace(/^Bearer\s+/i, '').trim() : null;
    const tokenFromBody = typeof body?.auth_token === 'string' ? body.auth_token.trim() : null;
    const token = tokenFromHeader || tokenFromBody;
    if (!token) return json(401, { error: 'Missing Authorization header' });

    const { data: authData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !authData.user) return json(401, { error: 'Invalid auth token' });
    const user = authData.user;

    const bookingId = typeof body?.booking_id === 'string' ? body.booking_id : null;
    const serviceType = ['photography', 'modeling', 'combined', 'video_call'].includes(body?.service_type) ? body.service_type : 'photography';
    const fanoutCount = Math.min(5, Math.max(1, asInt(body?.fanout_count, 1)));
    const intensityLevel = Math.min(5, Math.max(1, asInt(body?.intensity_level, 1)));
    const slaTimeout = Math.min(900, Math.max(15, asInt(body?.sla_timeout_seconds, 90)));
    const requiredTier = typeof body?.required_tier === 'string' ? body.required_tier : null;
    const requiredEquipment = body?.required_equipment ?? null;

    const requestedLat = Number(body?.requested_lat ?? body?.latitude ?? 0);
    const requestedLng = Number(body?.requested_lng ?? body?.longitude ?? 0);

    const { data: booking, error: bookingErr } = bookingId
      ? await admin
          .from('bookings')
          .select('id, client_id, booking_date, package_type, total_amount, price_total')
          .eq('id', bookingId)
          .maybeSingle()
      : { data: null, error: null };

    if (bookingErr) return json(500, { error: bookingErr.message });
    if (booking && booking.client_id !== user.id) return json(403, { error: 'You can only dispatch your own booking.' });

    const { data: policy } = await admin
      .from('pricing_policies')
      .select('base_multiplier, min_multiplier, max_multiplier, surge_threshold')
      .eq('active', true)
      .eq('service_type', serviceType === 'modeling' ? 'modeling' : 'photography')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const baseAmount = Number(body?.base_amount ?? booking?.total_amount ?? booking?.price_total ?? 1200);
    const baseMultiplier = Number(policy?.base_multiplier ?? 1);
    const intensityMultiplier = 1 + ((intensityLevel - 1) * 0.15);
    const fanoutMultiplier = 1 + ((fanoutCount - 1) * 0.05);
    const rawMultiplier = baseMultiplier * intensityMultiplier * fanoutMultiplier;
    const minMul = Number(policy?.min_multiplier ?? 1);
    const maxMul = Number(policy?.max_multiplier ?? 2.5);
    const totalMultiplier = Math.max(minMul, Math.min(maxMul, rawMultiplier));
    const totalAmount = Math.round(baseAmount * totalMultiplier * 100) / 100;

    const quoteToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + slaTimeout * 1000).toISOString();

    const { data: quote, error: quoteErr } = await admin
      .from('pricing_quotes')
      .insert({
        client_id: user.id,
        booking_id: bookingId,
        quote_token: quoteToken,
        fanout_count: fanoutCount,
        intensity_level: intensityLevel,
        base_amount: baseAmount,
        surge_multiplier: baseMultiplier,
        intensity_multiplier: intensityMultiplier,
        total_amount: totalAmount,
        expires_at: expiresAt,
      })
      .select('*')
      .single();

    if (quoteErr) return json(500, { error: quoteErr.message });

    const { data: dispatch, error: dispatchErr } = await admin
      .from('dispatch_requests')
      .insert({
        booking_id: bookingId,
        client_id: user.id,
        service_type: serviceType,
        fanout_count: fanoutCount,
        intensity_level: intensityLevel,
        sla_timeout_seconds: slaTimeout,
        status: 'offered',
        quote_token: quoteToken,
        requested_lat: Number.isFinite(requestedLat) ? requestedLat : null,
        requested_lng: Number.isFinite(requestedLng) ? requestedLng : null,
        price_base: baseAmount,
        price_multiplier: totalMultiplier,
        price_estimate: totalAmount,
        expires_at: expiresAt,
      })
      .select('*')
      .single();

    if (dispatchErr) return json(500, { error: dispatchErr.message });

    const table = serviceType === 'modeling' ? 'models' : 'photographers';
    const latCol = 'latitude';
    const lngCol = 'longitude';
    const { data: candidates } = await admin
      .from(table)
      .select(`id, ${latCol}, ${lngCol}, tier_id, equipment`)
      .not(latCol, 'is', null)
      .not(lngCol, 'is', null)
      .limit(50);

    const candidateIds = (candidates ?? []).map((c: any) => c.id).filter(Boolean);
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, kyc_status, age_verified, availability_status')
      .in('id', candidateIds);

    const eligibleIds = new Set(
      (profiles ?? [])
        .filter((p: any) => p?.kyc_status === 'approved' && Boolean(p?.age_verified) && isOnlineStatus(p?.availability_status))
        .map((p: any) => p.id)
    );

    const ranked = (candidates ?? [])
      .filter((c: any) => eligibleIds.has(c.id))
      .filter((c: any) => !requiredTier || String(c?.tier_id ?? '') === requiredTier)
      .filter((c: any) => equipmentMatches(c?.equipment, requiredEquipment))
      .map((c: any) => {
        const dLat = Number(c[latCol]) - requestedLat;
        const dLng = Number(c[lngCol]) - requestedLng;
        const score = Number.isFinite(dLat) && Number.isFinite(dLng) ? (dLat * dLat + dLng * dLng) : Number.MAX_VALUE;
        return { provider_id: c.id, score };
      })
      .filter((x: any) => x.provider_id !== user.id)
      .sort((a: any, b: any) => a.score - b.score)
      .slice(0, fanoutCount);

    let offers: any[] = [];
    if (ranked.length > 0) {
      const payload = ranked.map((candidate, idx) => ({
        dispatch_request_id: dispatch.id,
        provider_id: candidate.provider_id,
        offer_rank: idx + 1,
        status: 'offered',
      }));

      const { data: insertedOffers, error: offersErr } = await admin
        .from('dispatch_offers')
        .insert(payload)
        .select('*');

      if (offersErr) return json(500, { error: offersErr.message });
      offers = insertedOffers ?? [];
    }

    await admin.from('dispatch_events').insert([
      {
        dispatch_request_id: dispatch.id,
        event_type: 'dispatch_created',
        actor_id: user.id,
        payload: { fanout_count: fanoutCount, intensity_level: intensityLevel, offer_count: offers.length },
      },
    ]);

    if (bookingId) {
      await admin
        .from('bookings')
        .update({
          fanout_count: fanoutCount,
          intensity_level: intensityLevel,
          quote_token: quoteToken,
          dispatch_request_id: dispatch.id,
          assignment_state: offers.length > 0 ? 'offered' : 'queued',
        })
        .eq('id', bookingId)
        .eq('client_id', user.id);
    }

    return json(200, {
      dispatch_request: dispatch,
      offers,
      quote,
      assignment_state: offers.length > 0 ? 'offered' : 'queued',
      eta_confidence: 0.7,
    });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
