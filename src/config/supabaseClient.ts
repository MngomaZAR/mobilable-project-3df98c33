import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { environment, readPublicConfig } from './environment';

const supabaseUrl = readPublicConfig('EXPO_PUBLIC_SUPABASE_URL');
const supabaseAnonKey =
  readPublicConfig('EXPO_PUBLIC_SUPABASE_ANON_KEY') ||
  readPublicConfig('EXPO_PUBLIC_SUPABASE_KEY');

const resolvedSupabaseUrl = String(supabaseUrl ?? '').trim();
const resolvedSupabaseAnonKey = String(supabaseAnonKey ?? '').trim();

export const hasSupabase = environment.backendProvider === 'supabase' && Boolean(resolvedSupabaseUrl && resolvedSupabaseAnonKey);
export const supabaseRestUrl = hasSupabase ? `${resolvedSupabaseUrl.replace(/\/+$/, '')}/rest/v1` : '';
export const supabaseFunctionUrl = hasSupabase ? `${resolvedSupabaseUrl.replace(/\/+$/, '')}/functions/v1` : '';
export const supabasePublishableKey = hasSupabase ? resolvedSupabaseAnonKey : '';

if (!hasSupabase) {
  console.error('Supabase environment variables are missing. The app will stay in offline-safe mode until backend config is provided.');
}

// Keep app boot stable when env is missing without implying a real backend is configured.
const safeSupabaseUrl = resolvedSupabaseUrl || 'https://backend-not-configured.invalid';
const safeSupabaseAnonKey = resolvedSupabaseAnonKey || 'offline-anon-key';

export const supabase = createClient(safeSupabaseUrl, safeSupabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      'x-client-info': 'papzi-app',
    },
  },
});
