const BRAND = require('./src/constants/brand.json');

const APP_IDS = {
  slug: 'papzshipped',
  scheme: 'papzi',
  bundleIdentifier: 'com.saicts.papzi',
  androidPackage: 'com.saicts.papzi',
};

export default {
  expo: {
    name: BRAND.name,
    slug: APP_IDS.slug,
    owner: "mavuso",
    scheme: APP_IDS.scheme,
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: APP_IDS.bundleIdentifier,
      infoPlist: {
        NSCameraUsageDescription: `${BRAND.name} needs access to your camera to let you take and share photos directly in chat.`,
        NSPhotoLibraryUsageDescription: `${BRAND.name} needs access to your photos to let you upload your portfolio and share media in chat.`,
        NSLocationWhenInUseUsageDescription: `${BRAND.name} uses your location to show available talent near you and track bookings.`,
        NSLocationAlwaysAndWhenInUseUsageDescription: `${BRAND.name} needs your location to track you during a live booking session.`,
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      package: APP_IDS.androidPackage,
      // Deep link intent filter so Android re-opens the app after OAuth redirect
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: APP_IDS.scheme, host: "auth" }],
          category: ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    plugins: [
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#ffffff"
        }
      ],
      [
        "expo-image-picker",
        {
          photosPermission: "The app accesses your photos to let you share them with others."
        }
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: `Allow ${BRAND.name} to use your location.`
        }
      ],
      "@maplibre/maplibre-react-native"
    ],
    extra: {
      eas: {
        projectId: "e0a67604-5f21-4215-9b2f-456ae50c632e"
      },
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ""
    }
  }
};
