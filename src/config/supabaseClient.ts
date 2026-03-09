import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 
  process.env.EXPO_PUBLIC_SUPABASE_KEY || 
  Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabase = Boolean(supabaseUrl && supabaseAnonKey);

if (!hasSupabase) {
  console.warn('Supabase environment variables are missing. Check your .env configuration. The app will fall back to local demo data.');
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
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

