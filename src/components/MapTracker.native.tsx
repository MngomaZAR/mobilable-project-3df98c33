import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BookingStatus } from '../types';
import { MapLibreGL, isMapLibreNativeAvailable } from './MapLibreWrapper';

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
  const [seconds, setSeconds] = useState(0);

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

  useEffect(() => {
    const timer = setInterval(() => setSeconds((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (value: number) => {
    const mins = Math.floor(value / 60);
    const secs = value % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

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
            id="route-glow"
            style={{
              lineColor: '#f2d6a6',
              lineWidth: 12,
              lineOpacity: 0.35,
              lineBlur: 2.5,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <MapLibreGL.LineLayer
            id="route-line"
            style={{
              lineColor: '#d4a862',
              lineWidth: 4,
              lineCap: 'round',
              lineJoin: 'round',
              lineDasharray: [2, 6],
            }}
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
      <View style={styles.timerOverlay}>
        <Text style={styles.timerText}>{formatTimer(seconds)}</Text>
        <Text style={styles.timerPlus}>+</Text>
      </View>
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
  timerOverlay: {
    position: 'absolute',
    bottom: 18,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 18,
  },
  timerText: {
    color: '#f5e7cc',
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 1,
  },
  timerPlus: {
    color: '#f2c97a',
    fontWeight: '900',
    fontSize: 18,
  },
});

