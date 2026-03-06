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

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

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

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });
    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return jsonResponse(401, { error: 'Unauthorized' });
    }

    const payload = await req.json().catch(() => null);
    const participantId = payload?.participant_id;
    const title = payload?.title;

    if (!participantId || typeof participantId !== 'string') {
      return jsonResponse(400, { error: 'participant_id is required' });
    }
    if (!isUuid(participantId)) {
      return jsonResponse(400, { error: 'participant_id must be a UUID' });
    }
    if (participantId === user.id) {
      return jsonResponse(400, { error: 'You cannot start a conversation with yourself' });
    }

    const { data: participantProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('id', participantId)
      .maybeSingle();
    if (!participantProfile) {
      return jsonResponse(404, { error: 'Participant profile not found' });
    }

    const { data: participantRows, error: participantRowsError } = await supabaseAdmin
      .from('conversation_participants')
      .select('conversation_id, user_id')
      .in('user_id', [user.id, participantId]);
    if (participantRowsError) {
      return jsonResponse(500, { error: participantRowsError.message });
    }

    const grouped = new Map<string, Set<string>>();
    (participantRows ?? []).forEach((row: any) => {
      const set = grouped.get(row.conversation_id) ?? new Set<string>();
      set.add(row.user_id);
      grouped.set(row.conversation_id, set);
    });

    const existingConversationId = Array.from(grouped.entries()).find(([, users]) => {
      return users.has(user.id) && users.has(participantId);
    })?.[0];

    if (existingConversationId) {
      const { data: existingConversation } = await supabaseAdmin
        .from('conversations')
        .select('id, title')
        .eq('id', existingConversationId)
        .maybeSingle();

      return jsonResponse(200, {
        id: existingConversation?.id ?? existingConversationId,
        title:
          existingConversation?.title ||
          title ||
          participantProfile.full_name ||
          'Conversation',
      });
    }

    const conversationTitle =
      (typeof title === 'string' && title.trim().length > 0 ? title.trim() : null) ||
      participantProfile.full_name ||
      'Conversation';

    const now = new Date().toISOString();
    const { data: newConversation, error: conversationError } = await supabaseAdmin
      .from('conversations')
      .insert({
        title: conversationTitle,
        created_by: user.id,
        last_message: 'Say hello 👋',
        last_message_at: now,
      })
      .select('id, title')
      .single();

    if (conversationError || !newConversation?.id) {
      return jsonResponse(500, {
        error: conversationError?.message || 'Unable to create conversation',
      });
    }

    const { error: participantInsertError } = await supabaseAdmin
      .from('conversation_participants')
      .upsert(
        [
          { conversation_id: newConversation.id, user_id: user.id },
          { conversation_id: newConversation.id, user_id: participantId },
        ],
        { onConflict: 'conversation_id,user_id' }
      );

    if (participantInsertError) {
      return jsonResponse(500, { error: participantInsertError.message });
    }

    return jsonResponse(200, { id: newConversation.id, title: newConversation.title });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Internal Server Error',
    });
  }
});

