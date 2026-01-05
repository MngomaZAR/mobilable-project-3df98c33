import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, Text, View } from 'react-native';
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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
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
        <View style={styles.mapWrapper}>
          <MapPreview markers={markers} />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f7f7fb',
  },
  container: {
    flex: 1,
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
  mapWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});

export default MapScreen;
