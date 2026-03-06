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

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

const resolveUser = async (authHeader: string) => {
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });
  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser();
  if (authError || !user) return null;
  return user;
};

const isParticipant = async (conversationId: string, userId: string) => {
  const { data, error } = await supabaseAdmin
    .from('conversation_participants')
    .select('conversation_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return false;
  return Boolean(data?.conversation_id);
};

const parseBody = (body: string) => {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed;
    }
  } catch (_err) {
    // legacy text body
  }
  return {
    type: 'text',
    text: body,
  };
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse(401, { error: 'Missing Authorization header' });
    }

    const user = await resolveUser(authHeader);
    if (!user) {
      return jsonResponse(401, { error: 'Unauthorized' });
    }

    const payload = await req.json().catch(() => null);
    const action = payload?.action;
    const conversationId = payload?.conversation_id;
    if (!conversationId || typeof conversationId !== 'string') {
      return jsonResponse(400, { error: 'conversation_id is required' });
    }

    const participant = await isParticipant(conversationId, user.id);
    if (!participant) {
      return jsonResponse(403, { error: 'You are not a participant in this conversation.' });
    }

    if (action === 'list') {
      const { data: rows, error } = await supabaseAdmin
        .from('messages')
        .select('id, chat_id, sender_id, body, created_at')
        .eq('chat_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        return jsonResponse(500, { error: error.message });
      }

      const unlockBookingIds = Array.from(
        new Set(
          (rows ?? [])
            .map((row: any) => parseBody(row.body))
            .filter((parsed: any) => parsed?.type === 'media' && parsed?.locked && parsed?.unlockBookingId)
            .map((parsed: any) => parsed.unlockBookingId)
        )
      );

      let bookingStatusMap = new Map<string, string>();
      if (unlockBookingIds.length > 0) {
        const { data: bookings } = await supabaseAdmin
          .from('bookings')
          .select('id, status')
          .in('id', unlockBookingIds);
        (bookings ?? []).forEach((booking: any) => {
          bookingStatusMap.set(booking.id, booking.status ?? 'pending');
        });
      }

      const messages = (rows ?? []).map((row: any) => {
        const parsed = parseBody(row.body);
        const messageType = parsed?.type === 'media' ? 'media' : 'text';
        const unlockBookingId = parsed?.unlockBookingId ?? null;
        const bookingStatus = unlockBookingId ? bookingStatusMap.get(unlockBookingId) : null;
        const unlocked = !parsed?.locked || bookingStatus === 'accepted' || bookingStatus === 'completed';
        return {
          id: row.id,
          chatId: row.chat_id,
          senderId: row.sender_id,
          text: parsed?.text ?? '',
          timestamp: row.created_at,
          messageType,
          mediaUrl: messageType === 'media' ? (unlocked ? parsed?.mediaUrl ?? null : null) : null,
          previewUrl: messageType === 'media' ? parsed?.previewUrl ?? parsed?.mediaUrl ?? null : null,
          locked: messageType === 'media' ? Boolean(parsed?.locked) : false,
          unlocked: messageType === 'media' ? unlocked : true,
          unlockBookingId,
        };
      });

      return jsonResponse(200, { messages });
    }

    if (action === 'send') {
      const messageType = payload?.message_type === 'media' ? 'media' : 'text';
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      const mediaUrl = typeof payload?.media_url === 'string' ? payload.media_url.trim() : '';
      const previewUrl =
        typeof payload?.preview_url === 'string' && payload.preview_url.trim().length > 0
          ? payload.preview_url.trim()
          : mediaUrl;
      const locked = Boolean(payload?.locked);
      const unlockBookingId =
        typeof payload?.unlock_booking_id === 'string' && payload.unlock_booking_id.trim().length > 0
          ? payload.unlock_booking_id.trim()
          : null;

      if (messageType === 'text' && !text) {
        return jsonResponse(400, { error: 'Message text is required.' });
      }
      if (messageType === 'media' && !mediaUrl) {
        return jsonResponse(400, { error: 'media_url is required for media messages.' });
      }

      if (locked && unlockBookingId) {
        const { data: booking } = await supabaseAdmin
          .from('bookings')
          .select('id, client_id, photographer_id')
          .eq('id', unlockBookingId)
          .maybeSingle();
        if (!booking) {
          return jsonResponse(400, { error: 'unlock_booking_id was not found.' });
        }
        if (booking.client_id !== user.id && booking.photographer_id !== user.id) {
          return jsonResponse(403, { error: 'You do not have access to this booking unlock target.' });
        }
      }

      const bodyPayload =
        messageType === 'media'
          ? {
              type: 'media',
              text,
              mediaUrl,
              previewUrl,
              locked,
              unlockBookingId,
            }
          : {
              type: 'text',
              text,
            };

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('messages')
        .insert({
          chat_id: conversationId,
          sender_id: user.id,
          body: JSON.stringify(bodyPayload),
        })
        .select('id, chat_id, sender_id, body, created_at')
        .single();

      if (insertError || !inserted) {
        return jsonResponse(500, { error: insertError?.message ?? 'Unable to send message.' });
      }

      const conversationUpdateMessage = messageType === 'media' ? 'Sent a photo' : text;
      await supabaseAdmin
        .from('conversations')
        .update({
          last_message: conversationUpdateMessage || 'New message',
          last_message_at: inserted.created_at,
        })
        .eq('id', conversationId);

      return jsonResponse(200, {
        message: {
          id: inserted.id,
          chatId: inserted.chat_id,
          senderId: inserted.sender_id,
          text: bodyPayload.text ?? '',
          timestamp: inserted.created_at,
          messageType,
          mediaUrl: messageType === 'media' ? mediaUrl : null,
          previewUrl: messageType === 'media' ? previewUrl : null,
          locked: messageType === 'media' ? locked : false,
          unlocked: messageType === 'media' ? !locked : true,
          unlockBookingId,
        },
      });
    }

    return jsonResponse(400, { error: 'Invalid action. Use list or send.' });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Internal Server Error',
    });
  }
});

