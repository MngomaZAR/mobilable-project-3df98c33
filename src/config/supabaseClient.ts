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
  console.error('Supabase environment variables are missing. The app will stay in offline-safe mode until backend config is provided.');
}

// Keep app boot stable when env is missing without implying a real backend is configured.
const safeSupabaseUrl = resolvedSupabaseUrl || 'http://127.0.0.1:54321';
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
