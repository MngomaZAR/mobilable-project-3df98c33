import Constants from 'expo-constants';

const appOwnership = (Constants.appOwnership ?? 'standalone').toLowerCase();

export const environment = {
  env: process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? 'development' : 'production'),
  region: process.env.EXPO_PUBLIC_REGION ?? 'za',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'support@papzi.app',
  appOwnership,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
};

export default environment;