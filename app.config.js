const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || "";

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  expo: {
    name: "Papzi",
    slug: "my-simple-expo",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    plugins: [
      "expo-notifications",
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "Allow Papzi to use your location to find nearby photographers.",
        },
      ],
    ],
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.saicts.papzi",
      buildNumber: "1.0.0",
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          "Papzi needs your location to show nearby photographers.",
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: "com.papzi.mobile",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
      ],
      ...(googleMapsApiKey && {
        config: {
          googleMaps: { apiKey: googleMapsApiKey },
        },
      }),
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    extra: {
      eas: {
        projectId: "2d37d693-bc7a-48c7-9729-3fd3a260245e",
      },
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY:
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_KEY,
    },
  },
};
