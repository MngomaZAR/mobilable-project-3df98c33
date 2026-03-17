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
    const consentType = typeof body?.consent_type === 'string' ? body.consent_type.trim() : '';
    const enabled = Boolean(body?.enabled);
    const legalBasis = typeof body?.legal_basis === 'string' && body.legal_basis.trim().length > 0 ? body.legal_basis.trim() : 'consent';
    const consentVersion = typeof body?.consent_version === 'string' ? body.consent_version.trim() : null;
    const context = typeof body?.context === 'object' && body.context ? body.context : {};

    if (!consentType) return json(400, { error: 'consent_type is required' });

    const eventPayload = {
      user_id: user.id,
      consent_type: consentType,
      legal_basis: legalBasis,
      consent_version: consentVersion,
      enabled,
      context,
      captured_at: new Date().toISOString(),
    };

    const { data: eventRow, error: eventErr } = await admin
      .from('consent_events')
      .insert(eventPayload)
      .select('*')
      .single();

    if (eventErr) return json(500, { error: eventErr.message });

    const { data: consentRow, error: consentErr } = await admin
      .from('user_consents')
      .upsert(
        {
          user_id: user.id,
          consent_type: consentType,
          granted: enabled,
          accepted: enabled,
          granted_at: new Date().toISOString(),
          accepted_at: new Date().toISOString(),
          legal_basis: legalBasis,
          version: consentVersion,
          metadata: context,
        },
        { onConflict: 'user_id,consent_type' }
      )
      .select('*')
      .single();

    if (consentErr) return json(500, { error: consentErr.message });

    return json(200, {
      success: true,
      consent_event: eventRow,
      user_consent: consentRow,
    });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
