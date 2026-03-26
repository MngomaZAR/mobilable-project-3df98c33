import { createClient } from '@supabase/supabase-js';

describe('Supabase E2E Authentication & Connection', () => {
  let supabase: any;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY;

  const isTruthy = (value?: string) => ['1', 'true', 'yes'].includes((value || '').toLowerCase());
  const requireLiveSupabase = isTruthy(process.env.CI) || isTruthy(process.env.REQUIRE_E2E_SUPABASE);

  beforeAll(() => {
    if (!supabaseUrl || !supabaseKey) {
      supabase = null;
      return;
    }

    supabase = createClient(supabaseUrl, supabaseKey);
  });

  it('should be able to reach the Supabase instance and query public schema (Photographers)', async () => {
    if (!supabase) {
      if (requireLiveSupabase) {
        throw new Error(
          'Supabase E2E requires EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_KEY).'
        );
      }

      console.warn(
        'Skipping Supabase live E2E: set REQUIRE_E2E_SUPABASE=1 (or CI=true) plus EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
      );
      return;
    }

    const { data, error } = await supabase
      .from('photographers')
      .select('id')
      .limit(1);

    // Should not return an auth error or network error
    expect(error).toBeNull();
    // It's okay if data is empty, but it should be an array
    expect(Array.isArray(data)).toBe(true);
  }, 20000);
});
