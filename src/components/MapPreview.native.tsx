import React, { useMemo } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MapMarker, MapPreviewProps } from './mapTypes';
import { DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates } from '../utils/geo';

MapLibreGL.setTelemetryEnabled(false);

const MAP_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

const getZoomLevel = (latDelta: number, lngDelta: number) => {
  const maxDelta = Math.max(latDelta, lngDelta);
  if (maxDelta > 20) return 3;
  if (maxDelta > 10) return 4;
  if (maxDelta > 6) return 5;
  if (maxDelta > 3) return 6;
  if (maxDelta > 2) return 7;
  if (maxDelta > 1) return 8;
  if (maxDelta > 0.6) return 10;
  if (maxDelta > 0.3) return 11;
  return 12;
};

export const MapPreview: React.FC<MapPreviewProps> = ({ markers, onMapError, onMarkerPress }) => {
  const { width } = useWindowDimensions();

  const invalidMarker = markers.find(
    (marker) => !Number.isFinite(marker.latitude) || !Number.isFinite(marker.longitude)
  );
  if (invalidMarker) {
    onMapError?.('Unable to render one or more map pins.');
  }

  const { center, zoomLevel } = useMemo(() => {
    const fallback = ensureSouthAfricanCoordinates({
      latitude: DEFAULT_CAPE_TOWN_COORDINATES.latitude,
      longitude: DEFAULT_CAPE_TOWN_COORDINATES.longitude,
    });
    if (markers.length === 0) {
      return { center: [fallback.longitude, fallback.latitude] as [number, number], zoomLevel: 9 };
    }

    const lats = markers.map((m) => m.latitude);
    const lngs = markers.map((m) => m.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const safeCenter = ensureSouthAfricanCoordinates({
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
    });
    const latDelta = Math.max(0.01, maxLat - minLat);
    const lngDelta = Math.max(0.01, maxLng - minLng);

    return {
      center: [safeCenter.longitude, safeCenter.latitude] as [number, number],
      zoomLevel: getZoomLevel(latDelta, lngDelta),
    };
  }, [markers]);

  const pinStyles = (marker: MapMarker) => ({
    ...styles.pin,
    backgroundColor: marker.type === 'user' ? '#3b82f6' : '#000',
    borderColor: marker.type === 'user' ? '#eff6ff' : '#27272a',
    borderWidth: 2,
    padding: marker.type === 'user' ? 6 : 8,
  });

  const photographerCount = markers.filter((marker: MapMarker) => marker.type !== 'user').length;

  return (
    <View style={[styles.container, { minHeight: Math.min(520, width < 480 ? 300 : 400) }]}>
      <MapLibreGL.MapView style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE_URL}>
        <MapLibreGL.Camera
          centerCoordinate={center}
          zoomLevel={zoomLevel}
          animationDuration={600}
        />
        {markers.map((marker) => (
          <MapLibreGL.PointAnnotation
            key={`${marker.type}-${marker.id}`}
            id={`${marker.type}-${marker.id}`}
            coordinate={[marker.longitude, marker.latitude]}
            onSelected={() => onMarkerPress?.(marker)}
          >
            <View style={pinStyles(marker)}>
              <Ionicons
                name={marker.type === 'user' ? 'navigate' : 'camera'}
                size={marker.type === 'user' ? 14 : 18}
                color="#fff"
                style={marker.type === 'user' ? { transform: [{ rotate: '45deg' }] } : undefined}
              />
            </View>
          </MapLibreGL.PointAnnotation>
        ))}
      </MapLibreGL.MapView>
      <View style={styles.overlay}>
        <Text style={styles.overlayLabel}>Live coverage</Text>
        <Text style={styles.overlayValue}>
          {photographerCount} photographer{photographerCount === 1 ? '' : 's'}
          {markers.some((marker) => marker.type === 'user') ? ' - you' : ''}
        </Text>
        <Text style={styles.overlayMeta}>OpenStreetMap tiles via MapLibre</Text>
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
  overlayLabel: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  overlayValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  overlayMeta: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
  },
  pin: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 6,
  },
});

