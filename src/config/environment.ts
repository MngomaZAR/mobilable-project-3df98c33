export const environment = {
  env: process.env.EXPO_PUBLIC_ENV ?? 'development',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'support@example.com',
  region: process.env.EXPO_PUBLIC_APP_REGION ?? 'us',
};
