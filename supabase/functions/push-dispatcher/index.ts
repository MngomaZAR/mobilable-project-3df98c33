import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type NotificationEvent = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response('Missing Supabase config', { status: 500, headers: corsHeaders });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const maxBatch = 50;

    const eventsRes = await admin
      .from('notification_events')
      .select('id,user_id,title,body,data,attempts')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(maxBatch);

    if (eventsRes.error) throw new Error(eventsRes.error.message);
    const events = (eventsRes.data ?? []) as NotificationEvent[];
    if (events.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    for (const event of events) {
      const tokensRes = await admin
        .from('push_tokens')
        .select('expo_push_token')
        .eq('user_id', event.user_id)
        .eq('enabled', true);

      if (tokensRes.error) {
        await admin
          .from('notification_events')
          .update({ status: 'failed', attempts: event.attempts + 1, last_error: tokensRes.error.message })
          .eq('id', event.id);
        continue;
      }

      const pushTokens = (tokensRes.data ?? []).map((t: { expo_push_token: string }) => t.expo_push_token);
      if (pushTokens.length === 0) {
        await admin
          .from('notification_events')
          .update({ status: 'failed', attempts: event.attempts + 1, last_error: 'No enabled push tokens' })
          .eq('id', event.id);
        continue;
      }

      const messages = pushTokens.map((to: string) => ({
        to,
        sound: 'default',
        title: event.title,
        body: event.body,
        data: event.data ?? {},
      }));

      const expoResp = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      const expoJson = await expoResp.json();

      if (!expoResp.ok) {
        await admin
          .from('notification_events')
          .update({
            status: event.attempts >= 2 ? 'failed' : 'queued',
            attempts: event.attempts + 1,
            last_error: JSON.stringify(expoJson),
          })
          .eq('id', event.id);
        continue;
      }

      await admin
        .from('notification_events')
        .update({ status: 'sent', attempts: event.attempts + 1, sent_at: new Date().toISOString(), last_error: null })
        .eq('id', event.id);
      processed += 1;
    }

    return new Response(JSON.stringify({ processed }), {
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
