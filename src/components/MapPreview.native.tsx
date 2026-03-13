import React, { useEffect, useMemo, useRef } from 'react';
import MapView, { Marker, Region, UrlTile } from 'react-native-maps';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MapMarker, MapPreviewProps } from './mapTypes';
import { DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates } from '../utils/geo';

export const MapPreview: React.FC<MapPreviewProps> = ({ markers, onMapError, onMarkerPress }) => {
  const mapRef = useRef<any | null>(null);
  const { width } = useWindowDimensions();

  const region: Region = useMemo(() => {
    const base = ensureSouthAfricanCoordinates({
      latitude: markers[0]?.latitude ?? DEFAULT_CAPE_TOWN_COORDINATES.latitude,
      longitude: markers[0]?.longitude ?? DEFAULT_CAPE_TOWN_COORDINATES.longitude,
    });

    return {
      latitude: base.latitude,
      longitude: base.longitude,
      latitudeDelta: markers.length > 1 ? 6 : 4,
      longitudeDelta: markers.length > 1 ? 6 : 4,
    };
  }, [markers]);

  useEffect(() => {
    if (!mapRef.current || markers.length === 0) return;
    const invalidMarker = markers.find(
      (marker) => !Number.isFinite(marker.latitude) || !Number.isFinite(marker.longitude)
    );
    if (invalidMarker) {
      onMapError?.('Unable to render one or more map pins.');
      return;
    }

    const coords = markers.map((marker: MapMarker) => ({
      latitude: marker.latitude,
      longitude: marker.longitude,
    }));
    // mapRef typing differs across platforms; keep it flexible here
    try {
      (mapRef.current as any).fitToCoordinates(coords, {
        edgePadding: { top: 60, bottom: 60, left: 40, right: 40 },
        animated: true,
      });
    } catch (_e) {
      onMapError?.('Unable to center the map preview.');
    }
  }, [markers, onMapError]);

  const pinStyles = (marker: MapMarker) => ({
    ...styles.pin,
    backgroundColor: marker.type === 'user' ? '#3b82f6' : '#000', // vibrant blue for user, sleek black for photographer
    borderColor: marker.type === 'user' ? '#eff6ff' : '#27272a',
    borderWidth: 2,
    padding: marker.type === 'user' ? 6 : 8,
  });

  const photographerCount = markers.filter((marker: MapMarker) => marker.type !== 'user').length;

  return (
    <View style={[styles.container, { minHeight: Math.min(520, width < 480 ? 300 : 400) }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        moveOnMarkerPress={false}
        showsUserLocation={markers.some((marker) => marker.type === 'user')}
        showsCompass={false}
      >
        <UrlTile urlTemplate="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} />
        {markers.map((marker) => (
          <Marker
            key={`${marker.type}-${marker.id}`}
            coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
            tracksViewChanges={false}
            onPress={() => onMarkerPress?.(marker)}
          >
            <View style={pinStyles(marker)}>
              <Ionicons name={marker.type === 'user' ? 'navigate' : 'camera'} size={marker.type === 'user' ? 14 : 18} color="#fff" style={marker.type === 'user' ? { transform: [{ rotate: '45deg' }] } : undefined} />
            </View>
          </Marker>
        ))}
      </MapView>
      <View style={styles.overlay}>
        <Text style={styles.overlayLabel}>Live coverage</Text>
        <Text style={styles.overlayValue}>
          {photographerCount} photographer{photographerCount === 1 ? '' : 's'}
          {markers.some((marker) => marker.type === 'user') ? ' · you' : ''}
        </Text>
        <Text style={styles.overlayMeta}>OpenStreetMap tiles via react-native-maps</Text>
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
