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
        .select('id, chat_id, sender_id, body, message_type, media_url, created_at')
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
        locked: false,
        unlocked: true,
      }));

      return jsonResponse(200, { messages });
    }

    // ── SEND ──────────────────────────────────────────────────────────────
    if (action === 'send') {
      const messageType = payload?.message_type === 'media' ? 'media' : 'text';
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      const mediaUrl = typeof payload?.media_url === 'string' ? payload.media_url.trim() : null;

      if (messageType === 'text' && !text) {
        return jsonResponse(400, { error: 'Message text is required.' });
      }
      if (messageType === 'media' && !mediaUrl) {
        return jsonResponse(400, { error: 'media_url is required for media messages.' });
      }

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('messages')
        .insert({
          chat_id: conversationId,     // only column needed — conversation_id is gone
          sender_id: user.id,
          body: text || (messageType === 'media' ? 'Sent a photo' : ''),
          message_type: messageType,
          media_url: mediaUrl,
        })
        .select('id, chat_id, sender_id, body, message_type, media_url, created_at')
        .single();

      if (insertError || !inserted) {
        return jsonResponse(500, { error: insertError?.message ?? 'Unable to send message.' });
      }

      // Update conversation preview
      const preview = messageType === 'media' ? '📷 Photo' : text;
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
          locked: false,
          unlocked: true,
        },
      });
    }

    return jsonResponse(400, { error: 'Invalid action. Use "list" or "send".' });

  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Internal Server Error',
    });
  }
});