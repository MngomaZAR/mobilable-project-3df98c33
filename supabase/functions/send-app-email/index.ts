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

const buildTemplate = (action: string, payload: any) => {
  if (action === 'verification_status') {
    const approved = payload?.status === 'approved';
    return {
      subject: approved ? 'Papzi verification approved' : 'Papzi verification update',
      text: approved
        ? 'Your creator verification has been approved. You can now access creator features.'
        : 'Your creator verification was not approved. Please review your details and resubmit.',
    };
  }

  if (action === 'payout_method_status') {
    const approved = payload?.status === 'verified';
    return {
      subject: approved ? 'Papzi payout method verified' : 'Papzi payout method update',
      text: approved
        ? `Your payout method (${payload?.bank_name ?? 'bank account'}) was verified.`
        : `Your payout method (${payload?.bank_name ?? 'bank account'}) needs updates before verification.`,
    };
  }

  if (action === 'booking_status') {
    const status = String(payload?.status ?? '').toLowerCase();
    const bookingDate = payload?.booking_date ? new Date(payload.booking_date).toLocaleString('en-ZA') : null;
    if (status === 'accepted') {
      return {
        subject: 'Your Papzi booking was accepted',
        text: bookingDate
          ? `Good news. Your booking for ${bookingDate} has been accepted by the provider.`
          : 'Good news. Your booking has been accepted by the provider.',
      };
    }
    if (status === 'completed') {
      return {
        subject: 'Your Papzi booking is complete',
        text: bookingDate
          ? `Your booking session for ${bookingDate} was marked complete. Thanks for using Papzi.`
          : 'Your booking session was marked complete. Thanks for using Papzi.',
      };
    }
  }

  return {
    subject: payload?.subject ?? 'Papzi update',
    text: payload?.text ?? 'You have a new update in Papzi.',
  };
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method Not Allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const smtpHost = Deno.env.get('SMTP_HOST') ?? '';
    const smtpPort = Number(Deno.env.get('SMTP_PORT') ?? '587');
    const smtpUser = Deno.env.get('SMTP_USER') ?? '';
    const smtpPass = Deno.env.get('SMTP_PASS') ?? '';
    const smtpFromEmail = Deno.env.get('SMTP_FROM_EMAIL') ?? smtpUser;
    const smtpFromName = Deno.env.get('SMTP_FROM_NAME') ?? 'Papzi Admin';

    if (!smtpHost || !smtpUser || !smtpPass) {
      return jsonResponse(500, { error: 'SMTP is not configured in edge function secrets.' });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return jsonResponse(401, { error: 'Unauthorized' });

    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? 'custom';
    const targetUserId = body?.user_id ?? user.id;
    let resolvedBody: any = { ...body };

    const { data: actorProfile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const actorIsAdmin = actorProfile?.role === 'admin';

    // Non-self mail actions require admin, except booking participant updates for accepted/completed.
    if (targetUserId !== user.id && !actorIsAdmin) {
      if (action !== 'booking_status') {
        return jsonResponse(403, { error: 'Only admins can send email for other users.' });
      }

      const bookingId = body?.booking_id;
      const requestedStatus = String(body?.status ?? '').toLowerCase();
      if (!bookingId || !['accepted', 'completed'].includes(requestedStatus)) {
        return jsonResponse(400, { error: 'booking_id and status (accepted|completed) are required.' });
      }

      const { data: booking, error: bookingErr } = await admin
        .from('bookings')
        .select('id, client_id, photographer_id, model_id, status, booking_date')
        .eq('id', bookingId)
        .maybeSingle();
      if (bookingErr) throw bookingErr;
      if (!booking) return jsonResponse(404, { error: 'Booking not found.' });

      const participants = [booking.client_id, booking.photographer_id, booking.model_id].filter(Boolean);
      if (!participants.includes(user.id) || !participants.includes(targetUserId)) {
        return jsonResponse(403, { error: 'Only booking participants can trigger this email.' });
      }
      if (String(booking.status ?? '').toLowerCase() !== requestedStatus) {
        return jsonResponse(409, { error: 'Booking status mismatch. Retry after refresh.' });
      }
      resolvedBody.booking_date = resolvedBody.booking_date ?? booking.booking_date ?? null;
    } else if (action === 'booking_status' && body?.booking_id) {
      const { data: bookingMeta } = await admin
        .from('bookings')
        .select('booking_date')
        .eq('id', body.booking_id)
        .maybeSingle();
      resolvedBody.booking_date = resolvedBody.booking_date ?? bookingMeta?.booking_date ?? null;
    }

    const { data: targetUser, error: targetErr } = await admin.auth.admin.getUserById(targetUserId);
    if (targetErr || !targetUser?.user?.email) {
      return jsonResponse(404, { error: 'Target user email not found.' });
    }

    const template = buildTemplate(action, resolvedBody);
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const info = await transporter.sendMail({
      from: `${smtpFromName} <${smtpFromEmail}>`,
      to: targetUser.user.email,
      subject: template.subject,
      text: template.text,
    });

    return jsonResponse(200, { success: true, messageId: info.messageId, to: targetUser.user.email });
  } catch (err: any) {
    console.error('send-app-email error:', err);
    return jsonResponse(500, { error: err?.message || 'Internal Server Error' });
  }
});
