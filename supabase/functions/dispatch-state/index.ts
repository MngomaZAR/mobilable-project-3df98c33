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
    const dispatchRequestId = body?.dispatch_request_id || url.searchParams.get('dispatch_request_id');
    if (!dispatchRequestId || typeof dispatchRequestId !== 'string') {
      return json(400, { error: 'dispatch_request_id is required' });
    }

    const { data: request, error: requestErr } = await admin
      .from('dispatch_requests')
      .select('*')
      .eq('id', dispatchRequestId)
      .maybeSingle();

    if (requestErr) return json(500, { error: requestErr.message });
    if (!request) return json(404, { error: 'Dispatch request not found.' });

    const { data: offers, error: offersErr } = await admin
      .from('dispatch_offers')
      .select('*')
      .eq('dispatch_request_id', dispatchRequestId)
      .order('offer_rank', { ascending: true });

    if (offersErr) return json(500, { error: offersErr.message });

    const participant = request.client_id === user.id || request.assignment_profile_id === user.id || (offers ?? []).some((o: any) => o.provider_id === user.id);
    if (!participant) return json(403, { error: 'Not authorized for this dispatch request.' });

    const { data: events, error: eventsErr } = await admin
      .from('dispatch_events')
      .select('*')
      .eq('dispatch_request_id', dispatchRequestId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (eventsErr) return json(500, { error: eventsErr.message });

    return json(200, {
      dispatch_request: request,
      offers: offers ?? [],
      events: events ?? [],
      assignment_state: request.status,
      eta_confidence: request.status === 'accepted' ? 0.85 : 0.70,
    });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
