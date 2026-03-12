import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Payload = {
  mediaAssetId: string;
  ttlSeconds?: number;
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(500, { error: 'Missing Supabase env config' });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Missing Authorization header' });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json(401, { error: 'Unauthorized' });
    const userId = userData.user.id;

    const body = (await req.json()) as Payload;
    if (!body?.mediaAssetId) return json(400, { error: 'mediaAssetId required' });
    const ttlSeconds = Math.max(60, Math.min(3600, Number(body.ttlSeconds ?? 900)));

    const mediaRes = await admin
      .from('media_assets')
      .select('id, booking_id, bucket, object_path, watermarked, encrypted')
      .eq('id', body.mediaAssetId)
      .single();
    if (mediaRes.error) return json(404, { error: mediaRes.error.message });

    const bookingRes = await admin
      .from('bookings')
      .select('id,client_id,photographer_id')
      .eq('id', mediaRes.data.booking_id)
      .single();
    if (bookingRes.error) return json(404, { error: bookingRes.error.message });

    if (![bookingRes.data.client_id, bookingRes.data.photographer_id].includes(userId)) {
      return json(403, { error: 'Not allowed to access this media asset' });
    }
    if (userId === bookingRes.data.client_id && !mediaRes.data.watermarked) {
      return json(403, { error: 'Client download blocked until watermarked asset is ready' });
    }

    const signedRes = await admin.storage
      .from(mediaRes.data.bucket)
      .createSignedUrl(mediaRes.data.object_path, ttlSeconds);
    if (signedRes.error) return json(500, { error: signedRes.error.message });

    await admin.from('media_access_logs').insert({
      media_asset_id: mediaRes.data.id,
      user_id: userId,
      action: 'signed_url_requested',
      metadata: { ttlSeconds, watermarked: mediaRes.data.watermarked, encrypted: mediaRes.data.encrypted },
    });

    return json(200, {
      signedUrl: signedRes.data.signedUrl,
      expiresIn: ttlSeconds,
      policy: {
        encrypted: mediaRes.data.encrypted,
        watermarked: mediaRes.data.watermarked,
      },
    });
  } catch (error) {
    return json(500, { error: (error as Error).message });
  }
});
