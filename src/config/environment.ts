import Constants from 'expo-constants';

const appOwnership = (Constants.appOwnership ?? 'standalone').toLowerCase();

export const environment = {
  env: process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? 'development' : 'production'),
  region: process.env.EXPO_PUBLIC_REGION ?? 'za',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'support@papzi.co.za',
  appOwnership,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
};

/** Centralised Supabase Storage bucket names — change here and it propagates everywhere */
export const BUCKETS = {
  posts: 'post-images',
  avatars: 'avatars',
  previews: 'chat-media',   // chat previews go into chat-media bucket
  media: 'media',           // premium booking media bucket
  mediaAssets: 'media',     // alias — same as media
} as const;

export default environment;