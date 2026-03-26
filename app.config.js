export default {
  expo: {
    name: "Papzi",
    slug: "papzshipped",
    owner: "mavuso",
    scheme: "papzi",
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
      bundleIdentifier: "com.saicts.papzi",
      infoPlist: {
        NSCameraUsageDescription: "Papzi needs access to your camera to let you take and share photos directly in chat.",
        NSPhotoLibraryUsageDescription: "Papzi needs access to your photos to let you upload your portfolio and share media in chat.",
        NSLocationWhenInUseUsageDescription: "Papzi uses your location to show available talent near you and track bookings.",
        NSLocationAlwaysAndWhenInUseUsageDescription: "Papzi needs your location to track you during a live booking session.",
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      package: "com.saicts.papzi",
      // Deep link intent filter so Android re-opens the app after OAuth redirect
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "papzi", host: "auth" }],
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
          locationAlwaysAndWhenInUsePermission: "Allow Papzi to use your location."
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
