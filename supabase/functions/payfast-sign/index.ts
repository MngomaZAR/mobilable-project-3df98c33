import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import md5 from 'https://esm.sh/blueimp-md5@2.19.0';

type SignPayload = {
  bookingId: string;
  amount: string;
  itemName: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  emailAddress?: string | null;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const isAllowedPassphrase = (value: string) => /^[A-Za-z0-9\-_\/]+$/.test(value);

const encodeParams = (params: Record<string, string>) =>
  Object.entries(params)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value.trim())}`)
    .join('&');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!supabaseUrl || !anonKey) {
      return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;

    const body = (await req.json()) as SignPayload;
    if (!body?.bookingId || !body?.amount || !body?.itemName || !body?.returnUrl || !body?.cancelUrl || !body?.notifyUrl) {
      return new Response(JSON.stringify({ error: 'Missing required payment parameters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!/^https:\/\//i.test(body.notifyUrl) || !/\/functions\/v1\/payfast-itn$/i.test(body.notifyUrl)) {
      return new Response(JSON.stringify({ error: 'notifyUrl must be an https URL ending with /functions/v1/payfast-itn' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ownership validation: only booking participants can sign
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, client_id, photographer_id, price_total')
      .eq('id', body.bookingId)
      .maybeSingle();
    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (![booking.client_id, booking.photographer_id].includes(userId)) {
      return new Response(JSON.stringify({ error: 'Not allowed to sign for this booking' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const expectedAmount = Number(booking.price_total ?? NaN);
    const requestedAmount = Number(body.amount);
    if (Number.isFinite(expectedAmount) && Number.isFinite(requestedAmount)) {
      const roundedExpected = Number(expectedAmount.toFixed(2));
      const roundedRequested = Number(requestedAmount.toFixed(2));
      if (roundedExpected !== roundedRequested) {
        return new Response(JSON.stringify({ error: 'Amount mismatch', expectedAmount: roundedExpected }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const merchantId = Deno.env.get('PAYFAST_MERCHANT_ID') ?? '';
    const merchantKey = Deno.env.get('PAYFAST_MERCHANT_KEY') ?? '';
    const passphrase = Deno.env.get('PAYFAST_PASSPHRASE') ?? '';
    const baseUrl = Deno.env.get('PAYFAST_BASE_URL') ?? 'https://sandbox.payfast.co.za/eng/process';

    if (!merchantId || !merchantKey || !passphrase) {
      return new Response(JSON.stringify({ error: 'PayFast signer not configured. Set PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isAllowedPassphrase(passphrase)) {
      return new Response(JSON.stringify({ error: 'Invalid PAYFAST_PASSPHRASE format. Allowed: letters, numbers, - _ /' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const params: Record<string, string> = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      amount: body.amount,
      item_name: body.itemName,
      return_url: body.returnUrl,
      cancel_url: body.cancelUrl,
      notify_url: body.notifyUrl,
      m_payment_id: body.bookingId,
    };

    if (body.emailAddress) {
      params.email_address = body.emailAddress;
    }

    const serialized = encodeParams(params);
    const signaturePayload = `${serialized}&passphrase=${encodeURIComponent(passphrase)}`;
    const signature = md5(signaturePayload);
    const paymentUrl = `${baseUrl}?${serialized}&signature=${signature}`;

    return new Response(JSON.stringify({ paymentUrl }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
