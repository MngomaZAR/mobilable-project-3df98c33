# EAS Build: Environment Variables

For **native builds** (iOS/Android), EAS runs on Expo's servers. Set env vars in:

**expo.dev** → Your project → **Project settings** → **Environment variables**

Add these for the `production` and `preview` environments:

| Variable | Required | Notes |
|----------|----------|-------|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | No | For Android maps (optional) |

**Without these**, the build will complete but the app may show a blank screen or fail to connect to Supabase.
