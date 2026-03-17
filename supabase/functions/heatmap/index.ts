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
    const role = ['photographer', 'model', 'combined'].includes(body?.role) ? body.role : 'combined';
    const hours = Math.min(48, Math.max(1, Number(body?.hours ?? 12)));
    const city = typeof body?.city === 'string' ? body.city : null;

    const fromTs = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    let query = admin
      .from('availability_heatmap_hourly')
      .select('role,geohash,city,bucket_start,online_count,demand_count,completed_count')
      .gte('bucket_start', fromTs)
      .order('bucket_start', { ascending: false })
      .limit(500);

    if (role !== 'combined') query = query.eq('role', role);
    if (city) query = query.eq('city', city);

    const { data, error } = await query;
    if (error) return json(500, { error: error.message });

    return json(200, {
      generated_at: new Date().toISOString(),
      role,
      city,
      buckets: data ?? [],
    });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
