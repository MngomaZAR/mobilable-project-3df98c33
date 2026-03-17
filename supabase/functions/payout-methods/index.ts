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

const maskAccount = (value: string | null | undefined) => {
  const raw = String(value ?? '');
  const last4 = raw.slice(-4);
  return last4 ? `••••${last4}` : '••••';
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method Not Allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return jsonResponse(401, { error: 'Unauthorized' });

    const payload = await req.json().catch(() => ({}));
    const action = payload?.action ?? 'list';

    if (action === 'list') {
      const { data, error } = await admin
        .from('payout_methods')
        .select('id, bank_name, account_holder, account_number, account_type, branch_code, is_default, verified, created_at')
        .eq('user_id', user.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;

      return jsonResponse(200, {
        methods: (data ?? []).map((r: any) => ({
          id: r.id,
          bank_name: r.bank_name,
          account_holder: r.account_holder,
          account_masked: maskAccount(r.account_number),
          account_type: r.account_type,
          branch_code: r.branch_code,
          is_default: r.is_default,
          verified: r.verified,
        })),
      });
    }

    if (action === 'add') {
      const bankName = String(payload?.bank_name ?? '').trim();
      const accountHolder = String(payload?.account_holder ?? '').trim();
      const accountNumber = String(payload?.account_number ?? '').replace(/\s+/g, '').trim();
      const branchCode = String(payload?.branch_code ?? '').trim();
      const accountType = String(payload?.account_type ?? 'cheque');
      if (!bankName || !accountHolder || !accountNumber) {
        return jsonResponse(400, { error: 'bank_name, account_holder and account_number are required.' });
      }
      if (!/^\d{6,20}$/.test(accountNumber)) {
        return jsonResponse(400, { error: 'account_number must be numeric and between 6 and 20 digits.' });
      }
      if (!['cheque', 'savings', 'current'].includes(accountType)) {
        return jsonResponse(400, { error: 'Invalid account_type.' });
      }
      const { data: existing } = await admin
        .from('payout_methods')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);

      const { error } = await admin.from('payout_methods').insert({
        user_id: user.id,
        bank_name: bankName,
        account_holder: accountHolder,
        account_number: accountNumber,
        account_type: accountType,
        branch_code: branchCode || null,
        is_default: !existing || existing.length === 0,
      });
      if (error) throw error;
      return jsonResponse(200, { success: true });
    }

    if (action === 'set_default') {
      const id = payload?.id;
      if (!id) return jsonResponse(400, { error: 'id is required' });
      await admin.from('payout_methods').update({ is_default: false }).eq('user_id', user.id);
      const { error } = await admin.from('payout_methods').update({ is_default: true }).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
      return jsonResponse(200, { success: true });
    }

    if (action === 'delete') {
      const id = payload?.id;
      if (!id) return jsonResponse(400, { error: 'id is required' });
      const { data: existing, error: existingErr } = await admin
        .from('payout_methods')
        .select('id, is_default')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing) return jsonResponse(404, { error: 'Payout method not found.' });

      const { error: deleteErr } = await admin.from('payout_methods').delete().eq('id', id).eq('user_id', user.id);
      if (deleteErr) throw deleteErr;

      if (existing.is_default) {
        const { data: replacement, error: replacementErr } = await admin
          .from('payout_methods')
          .select('id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (replacementErr) throw replacementErr;
        if (replacement?.id) {
          const { error: setErr } = await admin
            .from('payout_methods')
            .update({ is_default: true })
            .eq('id', replacement.id)
            .eq('user_id', user.id);
          if (setErr) throw setErr;
        }
      }
      return jsonResponse(200, { success: true });
    }

    return jsonResponse(400, { error: `Unknown action: ${action}` });
  } catch (err: any) {
    console.error('payout-methods error:', err);
    return jsonResponse(500, { error: err?.message || 'Internal Server Error' });
  }
});
