// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import nodemailer from 'npm:nodemailer@6.9.15';

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

const sendMail = async (
  smtp: { host: string; port: number; user: string; pass: string; fromEmail: string; fromName: string },
  to: string,
  subject: string,
  text: string
) => {
  if (!smtp.host || !smtp.user || !smtp.pass) return { sent: false, reason: 'smtp_not_configured' };
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  const info = await transporter.sendMail({
    from: `${smtp.fromName} <${smtp.fromEmail}>`,
    to,
    subject,
    text,
  });
  return { sent: true, messageId: info.messageId };
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method Not Allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const smtp = {
      host: Deno.env.get('SMTP_HOST') ?? '',
      port: Number(Deno.env.get('SMTP_PORT') ?? '587'),
      user: Deno.env.get('SMTP_USER') ?? '',
      pass: Deno.env.get('SMTP_PASS') ?? '',
      fromEmail: Deno.env.get('SMTP_FROM_EMAIL') ?? (Deno.env.get('SMTP_USER') ?? ''),
      fromName: Deno.env.get('SMTP_FROM_NAME') ?? 'Papzi Admin',
    };

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return jsonResponse(401, { error: 'Unauthorized' });

    const { data: actorProfile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (actorProfile?.role !== 'admin') return jsonResponse(403, { error: 'Admin role required.' });

    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? 'list_pending';

    if (action === 'list_pending') {
      const [{ data: pendingProfiles, error: pErr }, { data: payoutRows, error: payoutErr }] = await Promise.all([
        admin
          .from('profiles')
          .select('id, full_name, role, kyc_status, created_at')
          .in('role', ['photographer', 'model'])
          .eq('kyc_status', 'pending')
          .order('created_at', { ascending: true }),
        admin
          .from('payout_methods')
          .select('id, user_id, bank_name, account_holder, account_number, account_type, branch_code, is_default, verified, created_at')
          .eq('verified', false)
          .order('created_at', { ascending: true }),
      ]);
      if (pErr) throw pErr;
      if (payoutErr) throw payoutErr;

      const uniqueUserIds = [...new Set((payoutRows ?? []).map((r: any) => r.user_id).filter(Boolean))];
      const { data: profileRows } = uniqueUserIds.length
        ? await admin.from('profiles').select('id, full_name, role').in('id', uniqueUserIds)
        : { data: [] as any[] };
      const profileMap: Record<string, any> = {};
      (profileRows ?? []).forEach((p: any) => { profileMap[p.id] = p; });

      const payoutMethods = (payoutRows ?? []).map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        user_name: profileMap[r.user_id]?.full_name ?? null,
        user_role: profileMap[r.user_id]?.role ?? null,
        bank_name: r.bank_name,
        account_holder: r.account_holder,
        account_masked: maskAccount(r.account_number),
        account_type: r.account_type,
        branch_code: r.branch_code,
        is_default: r.is_default,
        verified: r.verified,
        created_at: r.created_at,
      }));

      return jsonResponse(200, {
        verifications: pendingProfiles ?? [],
        payout_methods: payoutMethods,
      });
    }

    if (action === 'decide_verification') {
      const userId = body?.user_id;
      const decision = body?.decision; // approved | rejected
      if (!userId || !['approved', 'rejected'].includes(decision)) {
        return jsonResponse(400, { error: 'user_id and decision (approved|rejected) are required.' });
      }

      const { error: updateErr } = await admin.from('profiles').update({ kyc_status: decision }).eq('id', userId);
      if (updateErr) throw updateErr;

      await admin
        .from('moderation_cases')
        .update({ status: decision === 'approved' ? 'resolved' : 'escalated' })
        .eq('target_user_id', userId)
        .eq('target_type', 'profile')
        .in('status', ['open', 'in_review']);

      const { data: targetUser } = await admin.auth.admin.getUserById(userId);
      const email = targetUser?.user?.email ?? null;
      let emailResult: any = { sent: false };
      if (email) {
        emailResult = await sendMail(
          smtp,
          email,
          decision === 'approved' ? 'Papzi verification approved' : 'Papzi verification update',
          decision === 'approved'
            ? 'Your creator verification has been approved. You can now access creator features.'
            : 'Your creator verification was not approved. Please review your details and resubmit.'
        );
      }
      return jsonResponse(200, { success: true, email: emailResult });
    }

    if (action === 'decide_payout') {
      const payoutMethodId = body?.payout_method_id;
      const decision = body?.decision; // verified | rejected
      if (!payoutMethodId || !['verified', 'rejected'].includes(decision)) {
        return jsonResponse(400, { error: 'payout_method_id and decision (verified|rejected) are required.' });
      }

      const { data: method, error: mErr } = await admin
        .from('payout_methods')
        .select('id, user_id, bank_name')
        .eq('id', payoutMethodId)
        .maybeSingle();
      if (mErr) throw mErr;
      if (!method) return jsonResponse(404, { error: 'Payout method not found.' });

      if (decision === 'verified') {
        const { error } = await admin.from('payout_methods').update({ verified: true }).eq('id', payoutMethodId);
        if (error) throw error;
      } else {
        const { error } = await admin.from('payout_methods').delete().eq('id', payoutMethodId);
        if (error) throw error;
      }

      const { data: targetUser } = await admin.auth.admin.getUserById(method.user_id);
      const email = targetUser?.user?.email ?? null;
      let emailResult: any = { sent: false };
      if (email) {
        emailResult = await sendMail(
          smtp,
          email,
          decision === 'verified' ? 'Papzi payout method verified' : 'Papzi payout method update',
          decision === 'verified'
            ? `Your payout method (${method.bank_name}) has been verified.`
            : `Your payout method (${method.bank_name}) was rejected and needs to be submitted again.`
        );
      }
      return jsonResponse(200, { success: true, email: emailResult });
    }

    return jsonResponse(400, { error: `Unknown action: ${action}` });
  } catch (err: any) {
    console.error('admin-review error:', err);
    return jsonResponse(500, { error: err?.message || 'Internal Server Error' });
  }
});

