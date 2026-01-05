import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

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

export const MapPreview: React.FC<Props> = ({ markers }) => (
  <View style={styles.container}>
    <View style={styles.banner}>
      <Text style={styles.title}>Native map preview</Text>
      <Text style={styles.subtitle}>OpenStreetMap tiles render on device; web shows fast-loading fallback.</Text>
      <Text style={styles.count}>{markers.length} photographers pinned</Text>
    </View>
    <View style={styles.list}>
      {markers.map((marker) => (
        <View key={marker.id} style={styles.markerRow}>
          <View>
            <Text style={styles.markerTitle}>{marker.title}</Text>
            <Text style={styles.markerMeta}>{marker.description}</Text>
          </View>
          <Text style={styles.markerCoords}>
            {marker.latitude.toFixed(2)}, {marker.longitude.toFixed(2)}
          </Text>
        </View>
      ))}
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  banner: {
    padding: 16,
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#cbd5e1',
    marginTop: 4,
    marginBottom: 12,
  },
  count: {
    color: '#e2e8f0',
    fontWeight: '700',
  },
  list: {
    padding: 16,
    backgroundColor: '#fff',
  },
  markerRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  markerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  markerMeta: {
    fontSize: 12,
    color: '#6b7280',
  },
  markerCoords: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 12,
  },
});
