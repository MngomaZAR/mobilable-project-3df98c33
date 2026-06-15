import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import md5 from 'https://esm.sh/blueimp-md5@2.19.0';

type PaymentRow = {
  id: string;
  booking_id: string;
  customer_id: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  provider_payment_id: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


const parsePayload = (raw: string) => {
  const params = new URLSearchParams(raw);
  const payload: Record<string, string> = {};
  for (const [key, value] of params.entries()) payload[key] = value;
  return payload;
};

const encodeParams = (payload: Record<string, string>) => {
  const entries = Object.entries(payload)
    .filter(([key]) => key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b));

  return entries
    .map(([key, value]) => `${key}=${encodeURIComponent(value ?? '').replace(/%20/g, '+')}`)
    .join('&');
};

const parseAmount = (input?: string) => {
  if (!input) return NaN;
  const n = Number(input);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : NaN;
};

const getRequestIp = (req: Request) => {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  const realIp = req.headers.get('x-real-ip') ?? '';
  const cfIp = req.headers.get('cf-connecting-ip') ?? '';
  return forwarded.split(',')[0]?.trim() || realIp.trim() || cfIp.trim() || '';
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const textOk = (message = 'OK') =>
  new Response(message, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const merchantId = Deno.env.get('PAYFAST_MERCHANT_ID') ?? '';
    const merchantKey = Deno.env.get('PAYFAST_MERCHANT_KEY') ?? '';
    const passphrase = Deno.env.get('PAYFAST_PASSPHRASE') ?? '';
    const validateUrl = Deno.env.get('PAYFAST_VALIDATE_URL') ?? 'https://sandbox.payfast.co.za/eng/query/validate';
    const allowedIpsRaw = Deno.env.get('PAYFAST_ITN_ALLOWED_IPS') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return textOk('OK');
    }
    if (!merchantId || !merchantKey || !passphrase) {
      return textOk('OK');
    }

    const raw = await req.text();
    const payload = parsePayload(raw);

    const paymentStatus = String(payload.payment_status ?? '').toUpperCase();
    const paymentOrBookingId = String(payload.m_payment_id ?? '');
    const pfPaymentId = String(payload.pf_payment_id ?? '');
    const merchantIdInPayload = String(payload.merchant_id ?? '');
    const merchantKeyInPayload = String(payload.merchant_key ?? '');
    const signature = String(payload.signature ?? '');
    const amountGross = parseAmount(payload.amount_gross);

    if (!paymentOrBookingId || !pfPaymentId || !signature || !merchantIdInPayload || !merchantKeyInPayload) {
      return textOk('OK');
    }

    if (merchantIdInPayload !== merchantId) {
      return textOk('OK');
    }
    if (merchantKeyInPayload !== merchantKey) {
      return textOk('OK');
    }

    // Signature verification.
    const base = encodeParams(payload);
    const expectedSignature = md5(`${base}&passphrase=${encodeURIComponent(passphrase)}`);
    if (signature.toLowerCase() !== expectedSignature.toLowerCase()) {
      return textOk('OK');
    }

    // Optional source IP filter.
    if (allowedIpsRaw.trim().length > 0) {
      const allowed = allowedIpsRaw
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const remoteIp = getRequestIp(req);
      if (!allowed.includes(remoteIp)) {
        return json(403, { error: 'IP not allowed' });
      }
    }

    // Server-to-server validation with PayFast.
    const validateResponse = await fetch(validateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: raw,
    });
    const validateText = (await validateResponse.text()).trim().toUpperCase();
    if (!validateResponse.ok || validateText !== 'VALID') {
      return textOk('OK');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const duplicatePaymentRes = await admin
      .from('payments')
      .select('id, booking_id, status')
      .eq('provider_payment_id', pfPaymentId)
      .limit(1)
      .maybeSingle();
    if (duplicatePaymentRes.error) {
      console.error('ITN duplicate payment lookup failed', duplicatePaymentRes.error.message);
      return textOk('OK');
    }

    const paymentByIdRes = await admin
      .from('payments')
      .select('id, booking_id, customer_id, amount, status, provider_payment_id')
      .eq('id', paymentOrBookingId)
      .maybeSingle();
    if (paymentByIdRes.error) {
      console.error('ITN payment lookup failed', paymentByIdRes.error.message);
      return textOk('OK');
    }

    let payment = paymentByIdRes.data as PaymentRow | null;
    if (!payment) {
      const paymentByBookingRes = await admin
        .from('payments')
        .select('id, booking_id, customer_id, amount, status, provider_payment_id')
        .eq('booking_id', paymentOrBookingId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (paymentByBookingRes.error) {
        console.error('ITN payment by booking lookup failed', paymentByBookingRes.error.message);
        return textOk('OK');
      }
      payment = paymentByBookingRes.data as PaymentRow | null;
    }

    if (!payment) return textOk('OK');

    if (duplicatePaymentRes.data && duplicatePaymentRes.data.booking_id !== payment.booking_id) {
      return textOk('OK');
    }

    const bookingId = payment.booking_id;
    if (!bookingId) {
      console.error('ITN payment missing booking_id', { paymentId: payment.id });
      return textOk('OK');
    }

    if (!Number.isFinite(amountGross)) {
      return textOk('OK');
    }

    const expectedAmount = Number(Number(payment.amount).toFixed(2));
    if (expectedAmount !== amountGross) {
      console.error('ITN amount mismatch', { expectedAmount, receivedAmount: amountGross });
      return textOk('OK');
    }

    // Idempotency: already processed same PayFast payment id.
    if (payment.provider_payment_id && payment.provider_payment_id === pfPaymentId && payment.status === 'completed') {
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    let mappedStatus: PaymentRow['status'] = 'failed';
    if (paymentStatus === 'COMPLETE') mappedStatus = 'completed';
    if (paymentStatus === 'CANCELLED') mappedStatus = 'cancelled';
    if (paymentStatus === 'FAILED') mappedStatus = 'failed';

    const updatePayment = await admin
      .from('payments')
      .update({
        status: mappedStatus,
        provider_payment_id: pfPaymentId,
        provider_status: paymentStatus,
        provider_payload: payload,
        processed_at: new Date().toISOString(),
        idempotency_key: `${pfPaymentId}:${paymentStatus}`,
      })
      .eq('id', payment.id);

    if (updatePayment.error) {
      console.error('ITN payment update failed', updatePayment.error.message);
      return textOk('OK');
    }

    if (mappedStatus === 'completed') {
      const updateBooking = await admin
        .from('bookings')
        .update({ status: 'accepted' })
        .eq('id', bookingId)
        .in('status', ['pending']);
      if (updateBooking.error) {
        console.error('ITN booking update failed', updateBooking.error.message);
        return textOk('OK');
      }

      await admin.from('notification_events').insert({
        user_id: payment.customer_id,
        event_type: 'booking_confirmed',
        title: 'Payment confirmed',
        body: 'Your booking payment was confirmed successfully.',
        data: { bookingId, paymentId: payment.id },
      });
    }

    await admin.from('system_event_logs').insert({
      source: 'payfast-itn',
      level: 'info',
      message: 'ITN processed',
      metadata: {
        bookingId,
        paymentId: payment.id,
        pfPaymentId,
        paymentStatus,
        mappedStatus,
      },
    });

    return new Response('ok', { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error('ITN error', error);
    return textOk('OK');
  }
});
