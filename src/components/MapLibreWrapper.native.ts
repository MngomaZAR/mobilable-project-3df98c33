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
if (!isExpoGo) {
  try {
    nativeMapLibre = require('@maplibre/maplibre-react-native').default;
  } catch {
    nativeMapLibre = null;
  }
}

export const isMapLibreNativeAvailable = Boolean(nativeMapLibre && !isExpoGo);
export const MapLibreGL: any = nativeMapLibre ?? buildFallback();
