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
    const action = payload?.action ?? 'token';

    if (action === 'end') {
      const sessionId = payload?.session_id;
      if (!sessionId) return jsonResponse(400, { error: 'session_id is required for action=end' });

      const { data: session, error: sessionErr } = await admin
        .from('video_call_sessions')
        .select('id, creator_id, viewer_id, started_at, status')
        .eq('id', sessionId)
        .maybeSingle();
      if (sessionErr) throw sessionErr;
      if (!session) return jsonResponse(404, { error: 'Session not found' });
      if (session.creator_id !== user.id && session.viewer_id !== user.id) {
        return jsonResponse(403, { error: 'Forbidden' });
      }

      const startedAt = session.started_at ? new Date(session.started_at).getTime() : Date.now();
      const durationSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

      const { error: updateErr } = await admin
        .from('video_call_sessions')
        .update({
          ended_at: new Date().toISOString(),
          duration_seconds: durationSeconds,
          status: 'ended',
        })
        .eq('id', sessionId);
      if (updateErr) throw updateErr;

      const { data: settlementRows, error: settleErr } = await admin.rpc('settle_video_call_session', {
        p_session_id: sessionId,
      });
      if (settleErr) throw settleErr;

      const settlement = Array.isArray(settlementRows) ? settlementRows[0] : settlementRows;

      return jsonResponse(200, {
        success: true,
        sessionId,
        durationSeconds,
        settlement: settlement ?? null,
      });
    }

    const creatorId = payload?.creator_id;
    const role = payload?.role ?? 'viewer'; // 'creator' or 'viewer'

    if (!creatorId) return jsonResponse(400, { error: 'creator_id is required' });

    const { data: roleRows, error: roleError } = await admin
      .from('profiles')
      .select('id, role')
      .in('id', [user.id, creatorId]);
    if (roleError) throw roleError;

    const roleMap: Record<string, string> = {};
    (roleRows ?? []).forEach((r: any) => { roleMap[r.id] = r.role; });
    const requesterRole = roleMap[user.id];
    const creatorRole = roleMap[creatorId];

    // Policy: video calls are only for client <-> model.
    if (role === 'viewer') {
      if (requesterRole !== 'client' || creatorRole !== 'model') {
        return jsonResponse(403, {
          error: 'Video calls are available only between clients and models.',
        });
      }
    }
    if (role === 'creator') {
      if (user.id !== creatorId || requesterRole !== 'model') {
        return jsonResponse(403, {
          error: 'Only approved model accounts can host video calls.',
        });
      }
    }

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

    const minHoldCredits = Math.max(1, Number(Deno.env.get('VIDEO_CALL_MIN_HOLD_CREDITS') ?? 30));
    const ratePerMinute = Math.max(1, Number(Deno.env.get('VIDEO_CALL_RATE_PER_MINUTE') ?? 15));

    if (role === 'viewer') {
      const { count: debtCount, error: debtErr } = await admin
        .from('video_call_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('viewer_id', user.id)
        .eq('billing_status', 'insufficient_credits');
      if (debtErr) throw debtErr;
      if ((debtCount ?? 0) > 0) {
        return jsonResponse(402, {
          error: 'You have an unsettled previous video session. Top up credits before starting a new call.',
          code: 'video_call_unsettled_balance',
        });
      }
    }

    // Record the session start
    let sessionId: string | null = null;
    if (role === 'viewer') {
      const { data: inserted, error: insErr } = await admin.from('video_call_sessions').insert({
        creator_id: creatorId,
        viewer_id: user.id,
        room_name: roomName,
        rate_per_minute: ratePerMinute,
        credits_held: minHoldCredits,
        billing_status: 'pending',
        status: 'active',
      }).select('id').single();
      if (insErr) throw insErr;
      sessionId = inserted?.id ?? null;

      const { error: holdErr } = await admin.rpc('credits_adjust_for_user', {
        p_user_id: user.id,
        p_amount: -minHoldCredits,
        p_reason: 'Video call hold',
        p_ref_type: 'video_call_hold',
        p_ref_id: sessionId,
      });

      if (holdErr) {
        if (sessionId) {
          await admin.from('video_call_sessions').delete().eq('id', sessionId);
        }
        return jsonResponse(402, {
          error: `You need at least ${minHoldCredits} credits to start a video call.`,
          code: 'video_call_insufficient_hold',
          minimum_credits: minHoldCredits,
        });
      }
    }

    return jsonResponse(200, {
      token: livekitToken,
      url: livekitUrl,
      roomName,
      sessionId,
      holdCredits: role === 'viewer' ? minHoldCredits : 0,
      ratePerMinute,
    });
  } catch (err: any) {
    console.error('livekit-token error:', err);
    return jsonResponse(500, { error: err.message || 'Internal Server Error' });
  }
});
