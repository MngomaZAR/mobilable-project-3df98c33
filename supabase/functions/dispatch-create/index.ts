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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRole) return json(500, { error: 'Missing Supabase env.' });

    const admin = createClient(supabaseUrl, serviceRole);
    const auth = req.headers.get('Authorization');
    if (!auth) return json(401, { error: 'Missing Authorization header' });

    const token = auth.replace(/^Bearer\s+/i, '').trim();
    const { data: authData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !authData.user) return json(401, { error: 'Invalid auth token' });
    const user = authData.user;

    const body = await req.json().catch(() => null) as any;
    const bookingId = typeof body?.booking_id === 'string' ? body.booking_id : null;
    const serviceType = ['photography', 'modeling', 'combined', 'video_call'].includes(body?.service_type) ? body.service_type : 'photography';
    const fanoutCount = Math.min(5, Math.max(1, asInt(body?.fanout_count, 1)));
    const intensityLevel = Math.min(5, Math.max(1, asInt(body?.intensity_level, 1)));
    const slaTimeout = Math.min(900, Math.max(15, asInt(body?.sla_timeout_seconds, 90)));

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
      .select(`id, ${latCol}, ${lngCol}`)
      .not(latCol, 'is', null)
      .not(lngCol, 'is', null)
      .limit(50);

    const ranked = (candidates ?? [])
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
