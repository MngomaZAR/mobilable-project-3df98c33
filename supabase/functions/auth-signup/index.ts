// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json; charset=utf-8',
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const isEffectiveProviderRole = (role: string) => role === 'photographer' || role === 'model';
const authCreateStatus = (message = '') => {
  const lower = message.toLowerCase();
  if (lower.includes('already') || lower.includes('registered') || lower.includes('exists')) return 409;
  if (lower.includes('password') || lower.includes('email')) return 400;
  return 500;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method Not Allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(500, { error: 'Auth service is not configured.' });
    }
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    const role = String(body?.role ?? 'client');
    const fullName = body?.fullName ?? body?.full_name ?? null;
    const dob = body?.dob ?? body?.date_of_birth ?? null;
    const extras = body?.extras ?? {};

    if (!email || !password) {
      return jsonResponse(400, { error: 'email and password are required.' });
    }
    if (!['client', 'photographer', 'model', 'admin'].includes(role)) {
      return jsonResponse(400, { error: 'Invalid role.' });
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        verified: false,
        full_name: fullName,
        role,
        city: extras?.city ?? null,
        phone: extras?.phone ?? null,
        gender: extras?.gender ?? null,
        date_of_birth: dob ?? null,
      },
    });

    if (createError || !created?.user?.id) {
      const message = createError?.message ?? 'Unable to create user.';
      return jsonResponse(authCreateStatus(message), { error: message });
    }

    const userId = created.user.id;
    const ageVerified = Boolean(dob);

    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id: userId,
        role,
        verified: false,
        kyc_status: role === 'photographer' || role === 'model' ? 'pending' : null,
        full_name: fullName ?? email,
        city: extras?.city ?? null,
        phone: extras?.phone ?? null,
        date_of_birth: dob ?? null,
        age_verified: ageVerified,
        age_verified_at: ageVerified ? new Date().toISOString() : null,
        contact_details: { gender: extras?.gender ?? null },
        availability_status: isEffectiveProviderRole(role) ? 'offline' : null,
      },
      { onConflict: 'id' },
    );
    if (profileError) {
      return jsonResponse(500, { error: profileError.message });
    }

    if (role === 'photographer') {
      const { error } = await admin.from('photographers').upsert(
        {
          id: userId,
          rating: 5,
          location: '',
          price_range: '',
          style: '',
          bio: '',
          tags: [],
          name: fullName ?? email,
        },
        { onConflict: 'id' },
      );
      if (error) return jsonResponse(500, { error: error.message });
    }

    if (role === 'model') {
      const { error } = await admin.from('models').upsert(
        {
          id: userId,
          rating: 5,
          location: '',
          price_range: '',
          style: '',
          bio: '',
          tags: [],
          portfolio_urls: [],
        },
        { onConflict: 'id' },
      );
      if (error) return jsonResponse(500, { error: error.message });
    }

    return jsonResponse(200, {
      user: {
        id: userId,
        email,
        role,
        full_name: fullName ?? email,
      },
    });
  } catch (err: any) {
    return jsonResponse(500, { error: err?.message || 'Internal Server Error' });
  }
});
