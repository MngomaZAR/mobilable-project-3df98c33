import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json; charset=utf-8',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const R = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const aa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!['GET', 'POST'].includes(req.method)) return json(405, { error: 'Method Not Allowed' });

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

    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => null) as any : null;
    const bookingId = body?.booking_id || url.searchParams.get('booking_id');
    if (!bookingId || typeof bookingId !== 'string') return json(400, { error: 'booking_id is required' });

    const { data: booking, error: bookingErr } = await admin
      .from('bookings')
      .select('id, client_id, photographer_id, model_id, user_latitude, user_longitude, dispatch_request_id')
      .eq('id', bookingId)
      .maybeSingle();

    if (bookingErr) return json(500, { error: bookingErr.message });
    if (!booking) return json(404, { error: 'Booking not found' });

    const isParticipant = [booking.client_id, booking.photographer_id, booking.model_id].includes(user.id);
    if (!isParticipant) return json(403, { error: 'Not authorized for this booking.' });

    const { data: latestEta } = await admin
      .from('eta_snapshots')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestEta) {
      return json(200, {
        booking_id: bookingId,
        eta_seconds: latestEta.eta_seconds,
        eta_minutes: Math.max(1, Math.round(Number(latestEta.eta_seconds) / 60)),
        eta_confidence: Number(latestEta.eta_confidence ?? 0.7),
        distance_km: Number(latestEta.distance_km ?? 0),
        source: latestEta.source,
        snapshot: latestEta,
      });
    }

    const providerId = booking.photographer_id || booking.model_id;
    if (!providerId) return json(400, { error: 'Booking has no assigned provider yet.' });

    let providerLat: number | null = null;
    let providerLng: number | null = null;

    const { data: photo } = await admin
      .from('photographers')
      .select('latitude,longitude')
      .eq('id', providerId)
      .maybeSingle();

    const { data: model } = providerLat == null && providerLng == null
      ? await admin.from('models').select('latitude,longitude').eq('id', providerId).maybeSingle()
      : { data: null } as any;

    providerLat = Number(photo?.latitude ?? model?.latitude ?? NaN);
    providerLng = Number(photo?.longitude ?? model?.longitude ?? NaN);

    const clientLat = Number(booking.user_latitude ?? NaN);
    const clientLng = Number(booking.user_longitude ?? NaN);

    if (![providerLat, providerLng, clientLat, clientLng].every(Number.isFinite)) {
      return json(200, {
        booking_id: bookingId,
        eta_seconds: 900,
        eta_minutes: 15,
        eta_confidence: 0.45,
        distance_km: null,
        source: 'fallback_missing_location',
      });
    }

    const distanceKm = haversineKm(providerLat, providerLng, clientLat, clientLng);
    const etaSeconds = Math.max(180, Math.round((distanceKm / 35) * 3600));
    const confidence = distanceKm < 5 ? 0.82 : distanceKm < 15 ? 0.74 : 0.64;

    const { data: snapshot } = await admin
      .from('eta_snapshots')
      .insert({
        booking_id: bookingId,
        dispatch_request_id: booking.dispatch_request_id,
        eta_seconds: etaSeconds,
        eta_confidence: confidence,
        distance_km: Math.round(distanceKm * 1000) / 1000,
        source: 'haversine_fallback',
      })
      .select('*')
      .single();

    await admin
      .from('bookings')
      .update({ eta_confidence: confidence })
      .eq('id', bookingId);

    return json(200, {
      booking_id: bookingId,
      eta_seconds: etaSeconds,
      eta_minutes: Math.max(1, Math.round(etaSeconds / 60)),
      eta_confidence: confidence,
      distance_km: Math.round(distanceKm * 1000) / 1000,
      source: 'haversine_fallback',
      snapshot,
    });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
