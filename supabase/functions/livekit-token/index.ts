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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method Not Allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY') ?? '';
    const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET') ?? '';
    const livekitUrl = Deno.env.get('LIVEKIT_URL') ?? 'wss://your-livekit-server.livekit.cloud';

    if (!livekitApiKey || !livekitApiSecret) {
      return jsonResponse(500, { error: 'LiveKit credentials not configured. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_URL in Edge Function secrets.' });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return jsonResponse(401, { error: 'Unauthorized' });

    const payload = await req.json().catch(() => ({}));
    const creatorId = payload?.creator_id;
    const role = payload?.role ?? 'viewer'; // 'creator' or 'viewer'

    if (!creatorId) return jsonResponse(400, { error: 'creator_id is required' });

    const roomName = `room_${creatorId}`;
    const participantIdentity = user.id;

    // Build JWT for LiveKit using Web Crypto API (Deno native)
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600; // 1 hour

    const videoGrant = {
      room: roomName,
      roomJoin: true,
      canPublish: role === 'creator',
      canSubscribe: true,
      canPublishData: true,
    };

    const header = { alg: 'HS256', typ: 'JWT' };
    const claims = {
      iss: livekitApiKey,
      sub: participantIdentity,
      iat: now,
      exp,
      video: videoGrant,
      name: user.email,
    };

    const encode = (obj: unknown) =>
      btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const headerB64 = encode(header);
    const payloadB64 = encode(claims);
    const signingInput = `${headerB64}.${payloadB64}`;

    const keyData = new TextEncoder().encode(livekitApiSecret);
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(signingInput));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const livekitToken = `${signingInput}.${sigB64}`;

    // Record the session start
    if (role === 'viewer') {
      await admin.from('video_call_sessions').insert({
        creator_id: creatorId,
        viewer_id: user.id,
        room_name: roomName,
        rate_per_minute: 15,
        status: 'active',
      }).select().single();
    }

    return jsonResponse(200, { token: livekitToken, url: livekitUrl, roomName });
  } catch (err: any) {
    console.error('livekit-token error:', err);
    return jsonResponse(500, { error: err.message || 'Internal Server Error' });
  }
});
