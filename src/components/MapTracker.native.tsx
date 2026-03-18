import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BookingStatus } from '../types';
import { MapLibreGL, isMapLibreNativeAvailable } from './MapLibreWrapper';

// Suppress the default API key warning (we use OpenStreetMap tiles, no key needed)
if (isMapLibreNativeAvailable) {
  MapLibreGL.setAccessToken(null);
}

type Coordinate = {
  latitude: number;
  longitude: number;
};

type Props = {
  client: Coordinate;
  photographer: Coordinate;
  status: BookingStatus;
};

export const MapTracker: React.FC<Props> = ({ client, photographer, status }) => {
  const { width } = useWindowDimensions();
  const cameraRef = useRef<any>(null);

  const centerLat = (client.latitude + photographer.latitude) / 2;
  const centerLng = (client.longitude + photographer.longitude) / 2;

  const lineFeature = useMemo(() => ({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [
        [client.longitude, client.latitude],
        [photographer.longitude, photographer.latitude],
      ],
    },
  }), [client.latitude, client.longitude, photographer.latitude, photographer.longitude]);

  useEffect(() => {
    if (!isMapLibreNativeAvailable) return;
    if (cameraRef.current) {
      cameraRef.current.fitBounds(
        [
          Math.min(client.longitude, photographer.longitude) - 0.05,
          Math.min(client.latitude, photographer.latitude) - 0.05,
        ],
        [
          Math.max(client.longitude, photographer.longitude) + 0.05,
          Math.max(client.latitude, photographer.latitude) + 0.05,
        ],
        80,
        500
      );
    }
  }, [client, photographer]);

  if (!isMapLibreNativeAvailable) {
    return (
      <View style={[styles.container, { height: Math.min(440, width < 480 ? 280 : 360), alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: '#475569', fontWeight: '600' }}>
          Live tracking map requires a development build.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height: Math.min(440, width < 480 ? 280 : 360) }]}>
      <MapLibreGL.MapView
        style={StyleSheet.absoluteFill}
        {...{ styleURL: "https://tiles.openfreemap.org/styles/liberty" } as any}
        logoEnabled={false}
        attributionEnabled={false}
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          centerCoordinate={[centerLng, centerLat]}
          zoomLevel={10}
        />
        {/* Line between client and photographer */}
        <MapLibreGL.ShapeSource id="route-source" shape={lineFeature}>
          <MapLibreGL.LineLayer
            id="route-line"
            style={{ lineColor: '#0f172a', lineWidth: 4, lineCap: 'round', lineJoin: 'round' }}
          />
        </MapLibreGL.ShapeSource>
        {/* Photographer pin */}
        <MapLibreGL.PointAnnotation
          id="photographer-pin"
          coordinate={[photographer.longitude, photographer.latitude]}
          title="Photographer"
        >
          <View style={[styles.pin, { backgroundColor: '#0f172a' }]} />
        </MapLibreGL.PointAnnotation>
        {/* Client pin */}
        <MapLibreGL.PointAnnotation
          id="client-pin"
          coordinate={[client.longitude, client.latitude]}
          title={`You - ${status}`}
        >
          <View style={[styles.pin, { backgroundColor: '#2563eb' }]} />
        </MapLibreGL.PointAnnotation>
      </MapLibreGL.MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    minHeight: 260,
  },
  pin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
});

