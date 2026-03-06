const appJson = require("./app.json");

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || "";

/** @type {import('expo/config').ExpoConfig} */
const config = {
  ...appJson.expo,
  android: {
    ...appJson.expo.android,
    ...(googleMapsApiKey
      ? {
          config: {
            ...(appJson.expo.android?.config || {}),
            googleMaps: { apiKey: googleMapsApiKey },
          },
        }
      : {}),
  },
};

module.exports = { expo: config };
