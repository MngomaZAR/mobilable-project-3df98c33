const ENV = {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
};

export const environment = {
    env: __DEV__ ? 'development' : 'production',
    region: 'ZA',
    supportEmail: 'support@papzi.app',
    supabaseUrl: ENV.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: ENV.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

export default ENV;
