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

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json(401, { error: 'Missing Authorization header' });

    const admin = createClient(supabaseUrl, serviceRole);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: authData, error: authErr } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authErr || !user) return json(401, { error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as any;
    const events = Array.isArray(body?.events) ? body.events : [body];
    const normalized = events
      .slice(0, 100)
      .map((evt: any) => ({
        user_id: user.id,
        post_id: typeof evt?.post_id === 'string' ? evt.post_id : null,
        event_type: typeof evt?.event_type === 'string' ? evt.event_type : null,
        dwell_ms: Number.isFinite(Number(evt?.dwell_ms)) ? Number(evt.dwell_ms) : null,
        metadata: evt?.metadata && typeof evt.metadata === 'object' ? evt.metadata : {},
      }))
      .filter((evt: any) => evt.post_id && evt.event_type);

    if (normalized.length === 0) {
      return json(400, { error: 'No valid recommendation events provided.' });
    }

    const { error: insertErr } = await admin
      .from('recommendation_events')
      .insert(normalized);

    if (insertErr) return json(400, { error: insertErr.message || 'Insert failed' });

    return json(200, { success: true, inserted: normalized.length });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
