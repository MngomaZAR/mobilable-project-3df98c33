export default {
  expo: {
    name: "Papzi",
    slug: "papzi",
    owner: "papz",
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
      bundleIdentifier: "com.papzi.app",
      infoPlist: {
        NSCameraUsageDescription: "Papzi needs access to your camera to let you take and share photos directly in chat.",
        NSMicrophoneUsageDescription: "Papzi needs access to your microphone for live video calls.",
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
      package: "com.papzi.app",
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
    updates: {
      enabled: false,
      url: "https://u.expo.dev/f0c1ef90-ac26-4e4c-a799-77b377e2f452"
    },
    runtimeVersion: {
      policy: "appVersion"
    },
    plugins: [
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#ffffff"
        }
      ],
      "@maplibre/maplibre-react-native",
      [
        "expo-image-picker",
        {
          "photosPermission": "The app accesses your photos to let you share them with others."
        }
      ],
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Allow Papzi to use your location."
        }
      ],
      [
        "react-native-maps",
        {
          "googleMapsApiKey": ""
        }
      ],
      "@livekit/react-native"
    ],
    extra: {
      eas: {
        projectId: "f0c1ef90-ac26-4e4c-a799-77b377e2f452"
      },
      EXPO_PUBLIC_SUPABASE_URL: "https://mizdvqhvspkjayffaqqd.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pemR2cWh2c3BramF5ZmZhcXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNjg0NzksImV4cCI6MjA4Mjk0NDQ3OX0.WBEcxhd0WFpay_J9l2_A1wpfkbpcIUiAQnp1VeMvNjY"
    }
  }
};
