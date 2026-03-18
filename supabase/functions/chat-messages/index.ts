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
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    throw new Error(`Auth failed: ${error?.message || 'No user returned'}`);
  }
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

const canSendMessage = async (conversationId: string, senderId: string) => {
  // Only enforce anti-spam for 1:1 conversations.
  const { data: participants, error: participantsError } = await supabaseAdmin
    .from('conversation_participants')
    .select('user_id')
    .eq('conversation_id', conversationId);

  if (participantsError) {
    throw new Error(participantsError.message || 'Unable to validate conversation participants.');
  }

  const participantIds = (participants ?? []).map((p: any) => p.user_id).filter(Boolean);
  const recipientIds = participantIds.filter((id: string) => id !== senderId);

  if (recipientIds.length !== 1) {
    return { allowed: true };
  }

  const recipientId = recipientIds[0];

  // If this pair has a confirmed booking history, allow normal messaging.
  const { count: bookingCount, error: bookingError } = await supabaseAdmin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .or(
      [
        `and(client_id.eq.${senderId},photographer_id.eq.${recipientId})`,
        `and(client_id.eq.${recipientId},photographer_id.eq.${senderId})`,
        `and(client_id.eq.${senderId},model_id.eq.${recipientId})`,
        `and(client_id.eq.${recipientId},model_id.eq.${senderId})`,
      ].join(',')
    )
    .in('status', ['accepted', 'in_progress', 'completed', 'reviewed']);

  if (bookingError) {
    throw new Error(bookingError.message || 'Unable to validate booking relationship.');
  }
  if ((bookingCount ?? 0) > 0) {
    return { allowed: true };
  }

  // No booking history: recipient must reply before sender can send message #2.
  const [{ count: myCount, error: myCountError }, { count: recipientCount, error: recipientCountError }] = await Promise.all([
    supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', conversationId)
      .eq('sender_id', senderId),
    supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', conversationId)
      .eq('sender_id', recipientId),
  ]);

  if (myCountError || recipientCountError) {
    throw new Error(myCountError?.message || recipientCountError?.message || 'Unable to validate messaging policy.');
  }

  const senderMessages = myCount ?? 0;
  const recipientMessages = recipientCount ?? 0;

  if (senderMessages >= 1 && recipientMessages === 0) {
    return {
      allowed: false,
      code: 'message_limit_unknown_contact',
      message: 'For safety, you can send only one intro message until this user replies or you complete a booking together.',
    };
  }

  return { allowed: true };
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
    if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });

    const user = await resolveUser(authHeader);

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

    // ── LIST ──────────────────────────────────────────────────────────────
    if (action === 'list') {
      const { data: rows, error } = await supabaseAdmin
        .from('messages')
        .select('id, chat_id, sender_id, body, message_type, media_url, preview_url, locked, unlocked, unlock_booking_id, unlock_price, created_at')
        .eq('chat_id', conversationId)   // chat_id is the only FK now
        .order('created_at', { ascending: true });

      if (error) return jsonResponse(500, { error: error.message });

      const messages = (rows ?? []).map((row: any) => ({
        id: row.id,
        chatId: row.chat_id,
        conversationId: row.chat_id,     // alias for frontend compatibility
        senderId: row.sender_id,
        text: row.body || '',
        timestamp: row.created_at,
        messageType: row.message_type ?? 'text',
        mediaUrl: row.media_url ?? null,
        previewUrl: row.preview_url ?? null,
        locked: row.locked ?? false,
        unlocked: row.unlocked ?? true,
        unlockBookingId: row.unlock_booking_id ?? null,
        unlockPrice: row.unlock_price ? Number(row.unlock_price) : null,
      }));

      return jsonResponse(200, { messages });
    }

    // ── SEND ──────────────────────────────────────────────────────────────
    if (action === 'send') {
      const messageType = payload?.message_type === 'media' ? 'media' : 'text';
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      const mediaUrl = typeof payload?.media_url === 'string' ? payload.media_url.trim() : null;
      const previewUrl = typeof payload?.preview_url === 'string' ? payload.preview_url.trim() : null;
      const locked = Boolean(payload?.locked);
      const unlockBookingId = typeof payload?.unlock_booking_id === 'string' ? payload.unlock_booking_id.trim() : null;
      const unlockPrice = typeof payload?.unlock_price === 'number' ? payload.unlock_price : null;
      const unlocked = locked ? false : true;

      if (messageType === 'text' && !text) {
        return jsonResponse(400, { error: 'Message text is required.' });
      }
      if (messageType === 'media' && !mediaUrl) {
        return jsonResponse(400, { error: 'media_url is required for media messages.' });
      }

      const permission = await canSendMessage(conversationId, user.id);
      if (!permission.allowed) {
        return jsonResponse(429, { error: permission.message, code: permission.code });
      }

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('messages')
        .insert({
          chat_id: conversationId,     // only column needed — conversation_id is gone
          sender_id: user.id,
          body: text || (messageType === 'media' ? 'Sent a photo' : ''),
          message_type: messageType,
          media_url: mediaUrl,
          preview_url: previewUrl,
          locked,
          unlocked,
          unlock_booking_id: unlockBookingId,
          unlock_price: unlockPrice,
        })
        .select('id, chat_id, sender_id, body, message_type, media_url, preview_url, locked, unlocked, unlock_booking_id, unlock_price, created_at')
        .single();

      if (insertError || !inserted) {
        return jsonResponse(500, { error: insertError?.message ?? 'Unable to send message.' });
      }

      // Update conversation preview
      const preview = messageType === 'media' ? 'Photo' : text;
      await supabaseAdmin
        .from('conversations')
        .update({
          last_message: preview || 'New message',
          last_message_at: inserted.created_at,
        })
        .eq('id', conversationId);

      return jsonResponse(200, {
        message: {
          id: inserted.id,
          chatId: inserted.chat_id,
          conversationId: inserted.chat_id,   // alias for frontend compatibility
          senderId: inserted.sender_id,
          text: inserted.body || '',
          timestamp: inserted.created_at,
          messageType: inserted.message_type ?? 'text',
          mediaUrl: inserted.media_url ?? null,
          previewUrl: inserted.preview_url ?? null,
          locked: inserted.locked ?? false,
          unlocked: inserted.unlocked ?? true,
          unlockBookingId: inserted.unlock_booking_id ?? null,
          unlockPrice: inserted.unlock_price ? Number(inserted.unlock_price) : null,
        },
      });
    }

    // ── UNLOCK ────────────────────────────────────────────────────────────
    if (action === 'unlock') {
      const messageId = payload?.message_id;
      if (!messageId) return jsonResponse(400, { error: 'message_id is required' });

      // 1. Get message
      const { data: msg, error: msgError } = await supabaseAdmin
        .from('messages')
        .select('id, chat_id, sender_id, locked, unlocked, unlock_price')
        .eq('id', messageId)
        .single();
        
      if (msgError || !msg) return jsonResponse(404, { error: 'Message not found' });
      if (msg.chat_id !== conversationId) return jsonResponse(403, { error: 'Message not in this conversation' });
      if (msg.unlocked) return jsonResponse(400, { error: 'Message is already unlocked' });
      if (!msg.unlock_price || msg.unlock_price <= 0) return jsonResponse(400, { error: 'Message cannot be unlocked dynamically (no price set)' });
      if (msg.sender_id === user.id) return jsonResponse(400, { error: 'You cannot unlock your own message' });

      // 2. Perform credit deduction
      // We must authenticate as the user to call the credits_adjust RPC since it uses auth.uid()
      const supabaseUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { error: deductErr } = await supabaseUser.rpc('credits_adjust', {
        p_amount: -msg.unlock_price,
        p_reason: 'Unlocked media message',
        p_ref_type: 'message_unlock',
        p_ref_id: msg.id
      });
      
      if (deductErr) return jsonResponse(402, { error: 'Insufficient credits or payment failed' });

      // 3. Mark message unlocked
      const { error: updateErr } = await supabaseAdmin
        .from('messages')
        .update({ unlocked: true })
        .eq('id', msg.id);

      if (updateErr) {
         return jsonResponse(500, { error: 'Failed to unlock message' });
      }

      // 4. Give earnings to creator
      await supabaseAdmin.from('earnings').insert({
        user_id: msg.sender_id,
        amount: msg.unlock_price,
        source_type: 'tip',
        source_id: msg.id,
        gross_amount: msg.unlock_price
      });

      return jsonResponse(200, { success: true });
    }

    return jsonResponse(400, { error: 'Invalid action. Use "list", "send", or "unlock".' });

  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Internal Server Error',
    });
  }
});
