import React from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';

const isExpoGo =
  (Constants as any)?.executionEnvironment === 'storeClient' ||
  (Constants as any)?.appOwnership === 'expo';

const buildFallback = () => {
  const Box: React.FC<any> = ({ children, style }) => React.createElement(View, { style }, children);
  return {
    setAccessToken: (_token: string | null) => {},
    MapView: Box,
    Camera: () => null,
    ShapeSource: Box,
    LineLayer: () => null,
    CircleLayer: () => null,
    SymbolLayer: () => null,
    PointAnnotation: Box,
  };
};

let nativeMapLibre: any = null;
let nativeAvailable = false;
if (!isExpoGo) {
  try {
    const loaded = require('@maplibre/maplibre-react-native').default;
    if (loaded?.MapView) {
      try {
        if (typeof loaded.setAccessToken === 'function') loaded.setAccessToken(null);
      } catch {
        // Native module exists in JS but is not correctly linked for this build.
      }
      nativeMapLibre = loaded;
      nativeAvailable = true;
    }
  } catch {
    nativeMapLibre = null;
    nativeAvailable = false;
  }
}

export const isMapLibreNativeAvailable = Boolean(nativeMapLibre && nativeAvailable && !isExpoGo);
export const MapLibreGL: any = nativeMapLibre ?? buildFallback();
