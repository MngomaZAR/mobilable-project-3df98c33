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
    const authHeader = req.headers.get('Authorization') || '';

    let viewerId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const { data: authData } = await admin.auth.getUser(token);
      viewerId = authData?.user?.id ?? null;
    }

    const { data: posts, error: postsErr } = await admin
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (postsErr) return json(500, { error: postsErr.message });

    const { data: scores } = await admin
      .from('status_scores')
      .select('user_id,seen_score,scene_rank');

    const { data: weightRow } = await admin
      .from('recommendation_weights')
      .select('recency_weight,engagement_weight,creator_status_weight,proximity_weight,completion_weight,monetization_weight,safety_weight')
      .eq('id', true)
      .maybeSingle();

    const weights = {
      recency: Number(weightRow?.recency_weight ?? 35),
      engagement: Number(weightRow?.engagement_weight ?? 2),
      creatorStatus: Number(weightRow?.creator_status_weight ?? 13),
      proximity: Number(weightRow?.proximity_weight ?? 6),
      completion: Number(weightRow?.completion_weight ?? 5),
      monetization: Number(weightRow?.monetization_weight ?? -15),
      safety: Number(weightRow?.safety_weight ?? 10),
    };

    const authorIds = Array.from(new Set((posts ?? []).map((p: any) => p.author_id).filter(Boolean)));
    const profileIds = viewerId ? Array.from(new Set([...authorIds, viewerId])) : authorIds;
    const { data: profileRows } = await admin
      .from('profiles')
      .select('id,city')
      .in('id', profileIds);
    const cityByUser = new Map((profileRows ?? []).map((r: any) => [r.id, r.city ?? null]));

    const { data: violationRows } = await admin
      .from('policy_violations')
      .select('user_id,severity,status')
      .in('user_id', authorIds);
    const unresolvedViolationScore = new Map<string, number>();
    (violationRows ?? []).forEach((v: any) => {
      if (!v?.user_id) return;
      if (v.status === 'resolved') return;
      unresolvedViolationScore.set(v.user_id, (unresolvedViolationScore.get(v.user_id) ?? 0) + Number(v.severity ?? 1));
    });

    let seenPosts = new Set<string>();
    const authorAffinity = new Map<string, number>();
    if (viewerId) {
      const { data: eventRows } = await admin
        .from('recommendation_events')
        .select('post_id,event_type,metadata')
        .eq('user_id', viewerId)
        .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1000);

      const postAuthor = new Map((posts ?? []).map((p: any) => [p.id, p.author_id]));
      (eventRows ?? []).forEach((evt: any) => {
        if (evt?.post_id && evt.event_type === 'impression') seenPosts.add(evt.post_id);
        const authorId = postAuthor.get(evt?.post_id);
        if (!authorId) return;
        const delta =
          evt.event_type === 'booking_conversion' ? 4 :
          evt.event_type === 'unlock' ? 3 :
          evt.event_type === 'share' ? 2 :
          evt.event_type === 'like' ? 1 :
          evt.event_type === 'open' ? 0.4 :
          evt.event_type === 'hide' ? -2 :
          evt.event_type === 'skip' ? -0.7 : 0;
        authorAffinity.set(authorId, (authorAffinity.get(authorId) ?? 0) + delta);
      });
    }

    const scoreMap = new Map((scores ?? []).map((s: any) => [s.user_id, s]));
    const now = Date.now();

    const ranked = (posts ?? []).map((p: any) => {
      const ageHours = Math.max(1, (now - new Date(p.created_at).getTime()) / (1000 * 60 * 60));
      const recencyScore = 1 / ageHours;
      const engagementScore = Number(p.likes_count || 0) * 1.2 + Number(p.comment_count || 0) * 1.6;
      const creator = scoreMap.get(p.author_id);
      const seenScore = Number(creator?.seen_score || 0) / 100;
      const sceneRankScore = Number(creator?.scene_rank || 0) / 100;
      const creatorStatus = seenScore + sceneRankScore;
      const monetizationSignal = p.is_locked ? 1 : 0;
      const viewerCity = viewerId ? cityByUser.get(viewerId) : null;
      const authorCity = cityByUser.get(p.author_id);
      const proximityScore = viewerCity && authorCity && viewerCity === authorCity ? 1 : 0;
      const completionScore = sceneRankScore;
      const safetyPenalty = unresolvedViolationScore.get(p.author_id) ?? 0;
      const safetyScore = Math.max(0, 1 - Math.min(1, safetyPenalty / 10));
      const affinity = authorAffinity.get(p.author_id) ?? 0;
      const seenPenalty = seenPosts.has(p.id) ? -3 : 1;

      const score =
        recencyScore * weights.recency +
        engagementScore * weights.engagement +
        creatorStatus * weights.creatorStatus +
        proximityScore * weights.proximity +
        completionScore * weights.completion +
        monetizationSignal * weights.monetization +
        safetyScore * weights.safety +
        affinity +
        seenPenalty;

      return { post_id: p.id, score: Math.round(score * 1000) / 1000 };
    }).sort((a, b) => b.score - a.score).slice(0, limit);

    return json(200, {
      ranked_posts: ranked,
      generated_at: new Date().toISOString(),
      weights,
      personalized: Boolean(viewerId),
    });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
