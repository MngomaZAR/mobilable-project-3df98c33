const BRAND = require('./src/constants/brand.json');

const APP_IDS = {
  slug: 'papzi',
  scheme: 'papzi',
  bundleIdentifier: 'com.papzi.app',
  androidPackage: 'com.saicts.papzi',
};

export default {
  expo: {
    name: BRAND.name,
    slug: APP_IDS.slug,
    owner: "papz",
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
        NSCameraUsageDescription: `${BRAND.name} needs camera access for KYC verification and story creation.`,
        NSPhotoLibraryUsageDescription: `${BRAND.name} needs photo access for profile pictures, posts, and story creation.`,
        NSLocationWhenInUseUsageDescription: `${BRAND.name} uses your location to show nearby photographers and track bookings.`,
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
      permissions: [
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'CAMERA',
        'READ_EXTERNAL_STORAGE'
      ],
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
        projectId: "f0c1ef90-ac26-4e4c-a799-77b377e2f452"
      },
      EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV || "",
      EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || "",
      EXPO_PUBLIC_ROUTING_PROVIDER: process.env.EXPO_PUBLIC_ROUTING_PROVIDER || "osrm",
      EXPO_PUBLIC_OSRM_BASE_URL: process.env.EXPO_PUBLIC_OSRM_BASE_URL || "https://router.project-osrm.org",
      EXPO_PUBLIC_OPENROUTESERVICE_API_KEY: process.env.EXPO_PUBLIC_OPENROUTESERVICE_API_KEY || "",
      EXPO_PUBLIC_BACKEND_PROVIDER: process.env.EXPO_PUBLIC_BACKEND_PROVIDER || "api",
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "",
      EXPO_PUBLIC_NHOST_SUBDOMAIN: process.env.EXPO_PUBLIC_NHOST_SUBDOMAIN || "",
      EXPO_PUBLIC_NHOST_REGION: process.env.EXPO_PUBLIC_NHOST_REGION || "",
      EXPO_PUBLIC_STORE_TARGET: process.env.EXPO_PUBLIC_STORE_TARGET || "development",
      EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER: process.env.EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER || "external",
      EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES: process.env.EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES || "false"
    }
  }
};
