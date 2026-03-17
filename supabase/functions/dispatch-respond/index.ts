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
    const dispatchRequestId = typeof body?.dispatch_request_id === 'string' ? body.dispatch_request_id : null;
    const offerIdInput = typeof body?.offer_id === 'string' ? body.offer_id : null;
    const response = body?.response === 'accept' ? 'accept' : 'decline';
    const idempotencyKey = typeof body?.idempotency_key === 'string' ? body.idempotency_key : null;

    if (!dispatchRequestId) return json(400, { error: 'dispatch_request_id is required' });

    const { data: offer, error: offerErr } = offerIdInput
      ? await admin
          .from('dispatch_offers')
          .select('*')
          .eq('id', offerIdInput)
          .eq('dispatch_request_id', dispatchRequestId)
          .maybeSingle()
      : await admin
          .from('dispatch_offers')
          .select('*')
          .eq('dispatch_request_id', dispatchRequestId)
          .eq('provider_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

    if (offerErr) return json(500, { error: offerErr.message });
    if (!offer) return json(404, { error: 'Dispatch offer not found.' });
    if (offer.provider_id !== user.id) return json(403, { error: 'You can only respond to your own offer.' });

    if (response === 'accept') {
      const { data: accepted, error: acceptErr } = await admin.rpc('dispatch_accept_offer', {
        p_dispatch_request_id: dispatchRequestId,
        p_offer_id: offer.id,
        p_provider_id: user.id,
        p_idempotency_key: idempotencyKey,
      });

      if (acceptErr) return json(400, { error: acceptErr.message });

      await admin.from('dispatch_events').insert({
        dispatch_request_id: dispatchRequestId,
        event_type: 'provider_accepted',
        actor_id: user.id,
        payload: { offer_id: offer.id },
      });

      return json(200, { status: 'accepted', offer: accepted });
    }

    const { data: declined, error: declineErr } = await admin
      .from('dispatch_offers')
      .update({ status: 'declined', responded_at: new Date().toISOString(), idempotency_key: idempotencyKey })
      .eq('id', offer.id)
      .eq('provider_id', user.id)
      .select('*')
      .single();

    if (declineErr) return json(500, { error: declineErr.message });

    const { data: openOffers } = await admin
      .from('dispatch_offers')
      .select('id')
      .eq('dispatch_request_id', dispatchRequestId)
      .eq('status', 'offered')
      .limit(1);

    if (!openOffers || openOffers.length === 0) {
      await admin
        .from('dispatch_requests')
        .update({ status: 'expired' })
        .eq('id', dispatchRequestId)
        .in('status', ['queued', 'offered']);

      await admin
        .from('bookings')
        .update({ assignment_state: 'expired' })
        .eq('dispatch_request_id', dispatchRequestId)
        .in('assignment_state', ['queued', 'offered']);
    }

    await admin.from('dispatch_events').insert({
      dispatch_request_id: dispatchRequestId,
      event_type: 'provider_declined',
      actor_id: user.id,
      payload: { offer_id: offer.id },
    });

    return json(200, { status: 'declined', offer: declined });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
