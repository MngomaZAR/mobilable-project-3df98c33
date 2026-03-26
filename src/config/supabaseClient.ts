import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 
  process.env.EXPO_PUBLIC_SUPABASE_KEY || 
  Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const resolvedSupabaseUrl = String(supabaseUrl ?? '').trim();
const resolvedSupabaseAnonKey = String(supabaseAnonKey ?? '').trim();

export const hasSupabase = Boolean(resolvedSupabaseUrl && resolvedSupabaseAnonKey);

if (!hasSupabase) {
  console.warn('Supabase environment variables are missing. Check your .env configuration. The app will fall back to local demo data.');
}

// Keep app boot stable when env is missing (web smoke/dev flows) without pretending backend is configured.
const safeSupabaseUrl = resolvedSupabaseUrl || 'https://placeholder.supabase.co';
const safeSupabaseAnonKey = resolvedSupabaseAnonKey || 'public-anon-key';

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
