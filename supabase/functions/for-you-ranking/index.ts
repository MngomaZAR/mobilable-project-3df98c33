import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json; charset=utf-8',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRole) return json(500, { error: 'Missing Supabase env.' });

    const admin = createClient(supabaseUrl, serviceRole);
    const body = await req.json().catch(() => null) as any;
    const limit = Math.min(100, Math.max(10, Number(body?.limit ?? 40)));

    const { data: posts, error: postsErr } = await admin
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (postsErr) return json(500, { error: postsErr.message });

    const { data: scores } = await admin
      .from('status_scores')
      .select('user_id,seen_score,scene_rank');

    const scoreMap = new Map((scores ?? []).map((s: any) => [s.user_id, s]));
    const now = Date.now();

    const ranked = (posts ?? []).map((p: any) => {
      const ageHours = Math.max(1, (now - new Date(p.created_at).getTime()) / (1000 * 60 * 60));
      const recencyScore = 1 / ageHours;
      const engagementScore = Number(p.likes_count || 0) * 1.2 + Number(p.comment_count || 0) * 1.6;
      const creator = scoreMap.get(p.author_id);
      const seenScore = Number(creator?.seen_score || 0) / 100;
      const sceneRankScore = Number(creator?.scene_rank || 0) / 100;
      const monetizationPenalty = p.is_locked ? 0.85 : 1;
      const score = (recencyScore * 35 + engagementScore * 2 + seenScore * 8 + sceneRankScore * 5) * monetizationPenalty;
      return { post_id: p.id, score: Math.round(score * 1000) / 1000 };
    }).sort((a, b) => b.score - a.score).slice(0, limit);

    return json(200, { ranked_posts: ranked, generated_at: new Date().toISOString() });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
