import React, { useEffect, useMemo, useRef } from 'react';
import MapView, { Marker, Region, UrlTile } from 'react-native-maps';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MapMarker, MapPreviewProps } from './mapTypes';
import { DEFAULT_CAPE_TOWN_COORDINATES, validateSouthAfricanLocation } from '../utils/geo';

export const MapPreview: React.FC<MapPreviewProps> = ({ markers, onMapError }) => {
  const mapRef = useRef<any | null>(null);
  const { width } = useWindowDimensions();

  const region: Region = useMemo(() => {
    const baseLatitude = markers[0]?.latitude ?? DEFAULT_CAPE_TOWN_COORDINATES.latitude;
    const baseLongitude = markers[0]?.longitude ?? DEFAULT_CAPE_TOWN_COORDINATES.longitude;
    validateSouthAfricanLocation(baseLatitude, baseLongitude);

    return {
      latitude: baseLatitude,
      longitude: baseLongitude,
      latitudeDelta: markers.length > 1 ? 6 : 4,
      longitudeDelta: markers.length > 1 ? 6 : 4,
    };
  }, [markers]);

  useEffect(() => {
    if (!mapRef.current || markers.length === 0) return;
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
    } catch (e) {
      // ignore if the underlying native ref doesn't support this
    }
  }, [markers]);

  const pinStyles = (marker: MapMarker) => ({
    ...styles.pin,
    backgroundColor: marker.type === 'user' ? '#2563eb' : '#0f172a',
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
            key={marker.id}
            coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
            title={marker.title}
            description={marker.description}
            tracksViewChanges={false}
          >
            <View style={pinStyles(marker)}>
              <Ionicons name={marker.type === 'user' ? 'person' : 'camera'} size={18} color="#fff" />
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
    backgroundColor: '#0f172a',
    padding: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 4,
  },
});
