# Google Maps API Key Setup

The app uses **OpenStreetMap** tiles by default (no key required). For **Android**, `react-native-maps` may require a Google Maps API key for the map to render correctly. iOS uses Apple Maps and works without it.

## Current map setup

- **MapPreview** & **MapTracker**: `react-native-maps` with OpenStreetMap tiles (`UrlTile`)
- **Android**: May need Google API key for base map (depends on device/emulator)
- **iOS**: Uses Apple Maps, no Google key needed

## To add Google Maps API key

### 1. Create API key

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create or select a project
3. Enable **Maps SDK for Android** (and **Maps SDK for iOS** if you want Google Maps on iOS)
4. Create an API key
5. Restrict the key to your app (package `com.papzi.mobile`, SHA-1 from your signing key)

### 2. Add to your project

**Local development (.env):**
```
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_key_here
```

**EAS Build (native apps):**
- expo.dev → Your project → **Project settings** → **Environment variables**
- Add `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` for the `production` and/or `preview` environment

**GitHub Actions (web deploy):**
- Add `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` to repo secrets if the web build needs it (optional)

### 3. Rebuild

After adding the key, create a new native build. The key is read at build time via `app.config.js`.
