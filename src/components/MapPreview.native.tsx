import React, { useEffect, useMemo, useRef } from 'react';
import MapView, { MapView as MapViewType, Marker, Region, UrlTile } from 'react-native-maps';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

type MarkerInput = {
  id: string;
  title: string;
  description?: string;
  latitude: number;
  longitude: number;
};

type Props = {
  markers: MarkerInput[];
};

export const MapPreview: React.FC<Props> = ({ markers }) => {
  const mapRef = useRef<MapViewType | null>(null);
  const { width } = useWindowDimensions();

  const region: Region = useMemo(
    () => ({
      latitude: markers[0]?.latitude ?? 37.7749,
      longitude: markers[0]?.longitude ?? -122.4194,
      latitudeDelta: markers.length > 1 ? 6 : 4,
      longitudeDelta: markers.length > 1 ? 6 : 4,
    }),
    [markers]
  );

  useEffect(() => {
    if (!mapRef.current || markers.length === 0) return;
    const coords = markers.map((marker) => ({
      latitude: marker.latitude,
      longitude: marker.longitude,
    }));
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 60, bottom: 60, left: 40, right: 40 },
      animated: true,
    });
  }, [markers]);

  return (
    <View style={[styles.container, { height: Math.min(440, width < 480 ? 280 : 360) }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        moveOnMarkerPress={false}
        showsUserLocation={false}
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
            pinColor="#0f172a"
          />
        ))}
      </MapView>
      <View style={styles.overlay}>
        <Text style={styles.overlayLabel}>Live coverage</Text>
        <Text style={styles.overlayValue}>{markers.length} photographers</Text>
        <Text style={styles.overlayMeta}>OpenStreetMap tiles via react-native-maps</Text>
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
});
