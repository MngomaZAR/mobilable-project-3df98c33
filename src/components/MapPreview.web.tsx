import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MapPreviewProps } from './mapTypes';

export const MapPreview: React.FC<MapPreviewProps> = ({ markers }) => {
  const photographerMarkers = markers.filter((marker) => marker.type !== 'user');
  const userMarker = markers.find((marker) => marker.type === 'user');

  return (
    <>
      <View style={styles.container}>
        <View style={styles.banner}>
          <Text style={styles.title}>Nearby photographers</Text>
          <Text style={styles.count}>
            {photographerMarkers.length} photographers pinned
            {userMarker ? ' · your location included' : ''}
          </Text>
        </View>
        <View style={styles.list}>
          {userMarker ? (
            <View key={userMarker.id} style={[styles.markerRow, styles.markerRowHighlight]}>
              <View>
                <Text style={[styles.markerTitle, styles.markerTitleHighlight]}>{userMarker.title}</Text>
                <Text style={styles.markerMeta}>{userMarker.description}</Text>
              </View>
            </View>
          ) : null}
          {photographerMarkers.map((marker) => (
            <View key={marker.id} style={styles.markerRow}>
              <View>
                <Text style={styles.markerTitle}>{marker.title}</Text>
                <Text style={styles.markerMeta}>{marker.description}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: 280,
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
  markerRowHighlight: {
    backgroundColor: '#ecfeff',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  markerTitleHighlight: {
    color: '#0ea5e9',
  },
});
