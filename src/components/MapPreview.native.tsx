import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MapMarker, MapPreviewProps } from './mapTypes';
import { DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates } from '../utils/geo';
import { MapLibreGL, isMapLibreNativeAvailable } from './MapLibreWrapper';

// Suppress the default API key warning (we use OpenStreetMap tiles, no key needed)
if (isMapLibreNativeAvailable) {
  MapLibreGL.setAccessToken(null);
}

export const MapPreview: React.FC<MapPreviewProps> = ({ markers, onMapError, onMarkerPress }) => {
  const cameraRef = useRef<any>(null);
  const { width } = useWindowDimensions();

  const base = ensureSouthAfricanCoordinates({
    latitude: markers[0]?.latitude ?? DEFAULT_CAPE_TOWN_COORDINATES.latitude,
    longitude: markers[0]?.longitude ?? DEFAULT_CAPE_TOWN_COORDINATES.longitude,
  });

  useEffect(() => {
    if (!cameraRef.current || markers.length === 0) return;

    const invalid = markers.find(
      (m) => !Number.isFinite(m.latitude) || !Number.isFinite(m.longitude)
    );
    if (invalid) {
      onMapError?.('Unable to render one or more map pins.');
      return;
    }

    if (markers.length === 1) return; // camera already centered via prop

    try {
      const lngs = markers.map((m) => m.longitude);
      const lats = markers.map((m) => m.latitude);
      cameraRef.current.fitBounds(
        [Math.min(...lngs) - 0.5, Math.min(...lats) - 0.5],
        [Math.max(...lngs) + 0.5, Math.max(...lats) + 0.5],
        80,
        500
      );
    } catch (_e) {
      onMapError?.('Unable to center the map preview.');
    }
  }, [markers, onMapError]);

  const photographerCount = markers.filter((m) => m.type !== 'user').length;

  if (!isMapLibreNativeAvailable) {
    return (
      <View style={[styles.container, { minHeight: Math.min(520, width < 480 ? 300 : 400), alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="map-outline" size={28} color="#64748b" />
        <Text style={[styles.overlayMeta, { color: '#475569', marginTop: 8 }]}>
          Map preview needs a development build (not Expo Go).
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { minHeight: Math.min(520, width < 480 ? 300 : 400) }]}>
      <MapLibreGL.MapView
        style={StyleSheet.absoluteFill}
        // @ts-ignore: Known typings gap in maplibre-react-native 10+
        styleURL="https://tiles.openfreemap.org/styles/liberty"
        logoEnabled={false}
        attributionEnabled={false}
        onDidFailLoadingMap={() => onMapError?.('Map failed to load.')}
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          centerCoordinate={[base.longitude, base.latitude]}
          zoomLevel={markers.length > 1 ? 6 : 10}
          animationDuration={0}
        />
        {markers.map((marker) => (
          <MapLibreGL.PointAnnotation
            key={marker.id}
            id={`pin-${marker.id}`}
            coordinate={[marker.longitude, marker.latitude]}
            onSelected={() => onMarkerPress?.(marker)}
          >
            <View
              style={[
                styles.pin,
                {
                  backgroundColor: marker.type === 'user' ? '#3b82f6' : marker.type === 'model' ? '#ec4899' : '#000',
                  borderColor: marker.type === 'user' ? '#eff6ff' : '#27272a',
                  padding: marker.type === 'model' && marker.avatarUrl ? 0 : marker.type === 'user' ? 6 : 8,
                  overflow: 'hidden',
                },
              ]}
            >
              {marker.type === 'model' && marker.avatarUrl ? (
                <Image source={{ uri: marker.avatarUrl }} style={{ width: 36, height: 36, resizeMode: 'cover' }} />
              ) : (
                <Ionicons
                  name={marker.type === 'user' ? 'navigate' : marker.type === 'model' ? 'person' : 'camera'}
                  size={marker.type === 'user' ? 14 : 18}
                  color="#fff"
                  style={marker.type === 'user' ? { transform: [{ rotate: '45deg' }] } : undefined}
                />
              )}
            </View>
          </MapLibreGL.PointAnnotation>
        ))}
      </MapLibreGL.MapView>
      <View style={styles.overlay}>
        <Text style={styles.overlayLabel}>Live coverage</Text>
        <Text style={styles.overlayValue}>
          {photographerCount} photographer{photographerCount === 1 ? '' : 's'}
          {markers.some((m) => m.type === 'user') ? ' · you' : ''}
        </Text>
        <Text style={styles.overlayMeta}>OpenStreetMap via MapLibre</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  overlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
  },
  overlayLabel: { color: '#e2e8f0', fontSize: 12, fontWeight: '600' },
  overlayValue: { color: '#fff', fontSize: 16, fontWeight: '800' },
  overlayMeta: { color: '#cbd5e1', fontSize: 12, marginTop: 2 },
  pin: {
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 6,
  },
});
