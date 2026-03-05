import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHash } from 'node:crypto';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PAYFAST_MERCHANT_ID = Deno.env.get('PAYFAST_MERCHANT_ID') ?? '27309011';
const PAYFAST_MERCHANT_KEY = Deno.env.get('PAYFAST_MERCHANT_KEY') ?? '';
const PAYFAST_PASSPHRASE = Deno.env.get('PAYFAST_PASSPHRASE') ?? '';
const PAYFAST_ENDPOINT = Deno.env.get('PAYFAST_ENDPOINT') ?? 'https://www.payfast.co.za/eng/process';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const encodeValue = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');

const buildSignature = (params: Record<string, string>) => {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const paramString = entries
    .map(([key, value]) => `${key}=${encodeValue(value)}`)
    .join('&');
  const signatureBase =
    PAYFAST_PASSPHRASE && PAYFAST_PASSPHRASE.length > 0
      ? `${paramString}&passphrase=${encodeValue(PAYFAST_PASSPHRASE)}`
      : paramString;
  return createHash('md5').update(signatureBase).toString();
};

const parseFormBody = async (req: Request) => {
  const text = await req.text();
  const params = new URLSearchParams(text);
  const data: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    data[key] = value;
  }
  return data;
};

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const isNotify = url.pathname.endsWith('/notify');

  if (req.method === 'POST' && isNotify) {
    const body = await parseFormBody(req);
    const signature = body.signature ?? '';
    const payload = { ...body };
    delete payload.signature;
    const expected = buildSignature(payload);

    if (signature !== expected) {
      return new Response('invalid signature', { status: 400 });
    }

    const paymentStatus = body.payment_status ?? '';
    const paymentId = body.custom_str1 ?? body.m_payment_id ?? '';
    const bookingId = body.custom_str2 ?? '';
    const providerReference = body.pf_payment_id ?? '';

    if (paymentStatus.toUpperCase() === 'COMPLETE' && paymentId) {
      await supabaseAdmin
        .from('payments')
        .update({ status: 'paid', provider_reference: providerReference })
        .eq('id', paymentId);

      if (bookingId) {
        await supabaseAdmin.from('bookings').update({ status: 'accepted' }).eq('id', bookingId);
      }
    }

    return new Response('ok', { status: 200 });
  }

  if (req.method === 'POST') {
    const body = await req.json();
    const amount = String(body?.amount ?? '');
    const itemName = String(body?.item_name ?? 'Photography booking');
    const returnUrl = String(body?.return_url ?? '');
    const cancelUrl = String(body?.cancel_url ?? '');
    const notifyUrl = String(body?.notify_url ?? '');
    const bookingId = String(body?.booking_id ?? '');
    const paymentId = String(body?.payment_id ?? '');

    if (!PAYFAST_MERCHANT_ID || !PAYFAST_MERCHANT_KEY) {
      return jsonResponse({ error: 'PayFast credentials are missing.' }, 400);
    }

    const params: Record<string, string> = {
      merchant_id: PAYFAST_MERCHANT_ID,
      merchant_key: PAYFAST_MERCHANT_KEY,
      return_url: returnUrl,
      cancel_url: cancelUrl,
      notify_url: notifyUrl,
      amount,
      item_name: itemName,
      m_payment_id: paymentId,
      custom_str1: paymentId,
      custom_str2: bookingId,
    };

    const signature = buildSignature(params);
    const query = Object.entries(params)
      .filter(([, value]) => value !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${encodeValue(value)}`)
      .join('&');
    const paymentUrl = `${PAYFAST_ENDPOINT}?${query}&signature=${signature}`;

    return jsonResponse({ paymentUrl });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
});
