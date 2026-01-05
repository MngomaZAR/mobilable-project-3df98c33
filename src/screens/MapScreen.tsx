import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MapPreview } from '../components/MapPreview';
import { useAppData } from '../store/AppDataContext';

const MapScreen: React.FC = () => {
  const { state } = useAppData();
  const markers = state.photographers.map((photographer) => ({
    id: photographer.id,
    title: photographer.name,
    description: photographer.location,
    latitude: photographer.latitude,
    longitude: photographer.longitude,
  }));

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Photographers nearby</Text>
          <Text style={styles.subtitle}>
            Native apps render OpenStreetMap tiles with live markers. Web shows a preview list.
          </Text>
        </View>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{markers.length}</Text>
          <Text style={styles.countLabel}>active</Text>
        </View>
      </View>
      <MapPreview markers={markers} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f7f7fb',
    padding: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
    color: '#475569',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  countPill: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  countText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  countLabel: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default MapScreen;
