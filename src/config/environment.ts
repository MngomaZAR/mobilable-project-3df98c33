import Constants from 'expo-constants';
import { BRAND } from '../utils/constants';

const appOwnership = (Constants.appOwnership ?? 'standalone').toLowerCase();
const expoExtra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
// Expo only inlines public variables referenced with literal dot notation.
const publicProcessConfig: Record<string, string | undefined> = {
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_ROUTING_PROVIDER: process.env.EXPO_PUBLIC_ROUTING_PROVIDER,
  EXPO_PUBLIC_OSRM_BASE_URL: process.env.EXPO_PUBLIC_OSRM_BASE_URL,
  EXPO_PUBLIC_OPENROUTESERVICE_API_KEY: process.env.EXPO_PUBLIC_OPENROUTESERVICE_API_KEY,
  EXPO_PUBLIC_REGION: process.env.EXPO_PUBLIC_REGION,
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  EXPO_PUBLIC_OAUTH_ENABLED: process.env.EXPO_PUBLIC_OAUTH_ENABLED,
  EXPO_PUBLIC_BACKEND_PROVIDER: process.env.EXPO_PUBLIC_BACKEND_PROVIDER,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_SUPABASE_KEY: process.env.EXPO_PUBLIC_SUPABASE_KEY,
  EXPO_PUBLIC_NHOST_SUBDOMAIN: process.env.EXPO_PUBLIC_NHOST_SUBDOMAIN,
  EXPO_PUBLIC_NHOST_REGION: process.env.EXPO_PUBLIC_NHOST_REGION,
  EXPO_PUBLIC_STORE_TARGET: process.env.EXPO_PUBLIC_STORE_TARGET,
  EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER: process.env.EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER,
  EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES: process.env.EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES,
};

export const readPublicConfig = (name: string, fallback = '') => {
  const processValue = publicProcessConfig[name];
  if (typeof processValue === 'string' && processValue.trim()) return processValue;

  const extraValue = expoExtra[name];
  if (typeof extraValue === 'string' && extraValue.trim()) return extraValue;

  return fallback;
};

export const environment = {
  env: readPublicConfig('EXPO_PUBLIC_APP_ENV', __DEV__ ? 'development' : 'production'),
  apiBaseUrl: readPublicConfig('EXPO_PUBLIC_API_BASE_URL'),
  routingProvider: readPublicConfig('EXPO_PUBLIC_ROUTING_PROVIDER', 'osrm'),
  osrmBaseUrl: readPublicConfig('EXPO_PUBLIC_OSRM_BASE_URL', 'https://router.project-osrm.org'),
  openRouteServiceApiKey: readPublicConfig('EXPO_PUBLIC_OPENROUTESERVICE_API_KEY'),
  region: readPublicConfig('EXPO_PUBLIC_REGION', 'za'),
  supportEmail: readPublicConfig('EXPO_PUBLIC_SUPPORT_EMAIL', BRAND.email.support),
  oauthEnabled: readPublicConfig('EXPO_PUBLIC_OAUTH_ENABLED', 'false').toLowerCase() === 'true',
  appOwnership,
  backendProvider: readPublicConfig('EXPO_PUBLIC_BACKEND_PROVIDER', 'api'),
  EXPO_PUBLIC_SUPABASE_URL: readPublicConfig('EXPO_PUBLIC_SUPABASE_URL'),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: readPublicConfig('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
  EXPO_PUBLIC_API_BASE_URL: readPublicConfig('EXPO_PUBLIC_API_BASE_URL'),
  EXPO_PUBLIC_ROUTING_PROVIDER: readPublicConfig('EXPO_PUBLIC_ROUTING_PROVIDER', 'osrm'),
  EXPO_PUBLIC_OSRM_BASE_URL: readPublicConfig('EXPO_PUBLIC_OSRM_BASE_URL', 'https://router.project-osrm.org'),
  EXPO_PUBLIC_OPENROUTESERVICE_API_KEY: readPublicConfig('EXPO_PUBLIC_OPENROUTESERVICE_API_KEY'),
  EXPO_PUBLIC_OAUTH_ENABLED: readPublicConfig('EXPO_PUBLIC_OAUTH_ENABLED', 'false'),
  EXPO_PUBLIC_NHOST_SUBDOMAIN: readPublicConfig('EXPO_PUBLIC_NHOST_SUBDOMAIN'),
  EXPO_PUBLIC_NHOST_REGION: readPublicConfig('EXPO_PUBLIC_NHOST_REGION'),
  EXPO_PUBLIC_STORE_TARGET: readPublicConfig('EXPO_PUBLIC_STORE_TARGET', 'development'),
  EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER: readPublicConfig('EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER', 'external'),
  EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES: readPublicConfig('EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES', 'false'),
};

/** Centralised Supabase Storage bucket names - change here and it propagates everywhere. */
export const BUCKETS = {
  posts: 'post-images',
  avatars: 'avatars',
  previews: 'chat-media', // chat previews go into chat-media bucket
  media: 'media', // premium booking media bucket
  mediaAssets: 'media', // alias - same as media
} as const;

export default environment;
