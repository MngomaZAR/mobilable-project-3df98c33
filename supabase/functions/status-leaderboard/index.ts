import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json; charset=utf-8',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!['GET', 'POST'].includes(req.method)) return json(405, { error: 'Method Not Allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRole) return json(500, { error: 'Missing Supabase env.' });

    const admin = createClient(supabaseUrl, serviceRole);
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => null) as any : null;

    const city = String(body?.city || url.searchParams.get('city') || 'Cape Town');
    const limit = Math.min(100, Math.max(5, Number(body?.limit || url.searchParams.get('limit') || 20)));
    const nowIso = new Date().toISOString();

    const { data: activeTrend, error: trendErr } = await admin
      .from('trend_windows')
      .select('*')
      .eq('city', city)
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (trendErr) return json(500, { error: trendErr.message });

    if (activeTrend) {
      return json(200, {
        city,
        source: 'trend_window',
        generated_at: nowIso,
        leaderboard: activeTrend.leaderboard ?? [],
      });
    }

    const { data: rows, error: rowsErr } = await admin
      .from('status_scores')
      .select('user_id, seen_score, scene_rank, trending_badges, profiles!inner(full_name, avatar_url, city, role)')
      .order('seen_score', { ascending: false })
      .limit(limit);

    if (rowsErr) return json(500, { error: rowsErr.message });

    const leaderboard = (rows ?? []).map((row: any, idx: number) => ({
      rank: idx + 1,
      user_id: row.user_id,
      seen_score: row.seen_score,
      scene_rank: row.scene_rank,
      badges: row.trending_badges ?? [],
      full_name: row.profiles?.full_name ?? 'Creator',
      avatar_url: row.profiles?.avatar_url ?? null,
      city: row.profiles?.city ?? null,
      role: row.profiles?.role ?? null,
    }));

    return json(200, {
      city,
      source: 'status_scores',
      generated_at: nowIso,
      leaderboard,
    });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
