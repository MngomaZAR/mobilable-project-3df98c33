import { createClient } from '@supabase/supabase-js';

describe('Supabase E2E Authentication & Connection', () => {
  let supabase: any;

  beforeAll(() => {
    // Rely on environment variables being set or pulled from app config
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
    const supabaseKey =
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.EXPO_PUBLIC_SUPABASE_KEY ||
      'mock-key';
    
    // Create a real client against the actual network
    supabase = createClient(supabaseUrl, supabaseKey);
  });

  it('should be able to reach the Supabase instance and query public schema (Photographers)', async () => {
    // Only run this test if real env vars exist, else skip
    if (!process.env.EXPO_PUBLIC_SUPABASE_URL) {
      console.warn('Skipping E2E test due to missing EXPO_PUBLIC_SUPABASE_URL');
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
  }, 10000); // give generous timeout for live network
});
