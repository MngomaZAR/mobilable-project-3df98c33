import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Location from 'expo-location';
import { MapPreview } from '../components/MapPreview';
import { MapMarker } from '../components/mapTypes';
import { useAppData } from '../store/AppDataContext';
import { rankPhotographers } from '../utils/recommendation';
import { quotePaparazziSession } from '../utils/pricing';
import { formatCurrency, getCurrencyForLocale } from '../utils/format';
import { RootStackParamList } from '../navigation/types';

type Navigation = StackNavigationProp<RootStackParamList>;

const MapScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state } = useAppData();
  const [userMarker, setUserMarker] = useState<MapMarker | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [resolvedLocation, setResolvedLocation] = useState<string | null>(null);
  const localeCurrency = useMemo(() => getCurrencyForLocale(), []);

  const baseMarkers: MapMarker[] = useMemo(
    () =>
      state.photographers
        .filter(
          (photographer) =>
            Number.isFinite(photographer.latitude) && Number.isFinite(photographer.longitude)
        )
        .map((photographer) => ({
          id: photographer.id,
          title: photographer.name,
          description: photographer.location,
          latitude: photographer.latitude,
          longitude: photographer.longitude,
          type: 'photographer',
        })),
    [state.photographers]
  );

  const markers: MapMarker[] = useMemo(
    () => (userMarker ? [userMarker, ...baseMarkers] : baseMarkers),
    [baseMarkers, userMarker]
  );

  const recommendations = useMemo(() => {
    if (!userMarker) return [];
    const ranked = rankPhotographers(
      { latitude: userMarker.latitude, longitude: userMarker.longitude },
      state.photographers
    );
    if (!searchQuery.trim()) return ranked.slice(0, 8);
    const needle = searchQuery.trim().toLowerCase();
    return ranked
      .filter(({ photographer }) => {
        return (
          photographer.name.toLowerCase().includes(needle) ||
          photographer.location.toLowerCase().includes(needle) ||
          photographer.tags.some((tag) => tag.toLowerCase().includes(needle))
        );
      })
      .slice(0, 8);
  }, [searchQuery, state.photographers, userMarker]);

  const requestLocation = useCallback(async () => {
    setRequesting(true);
    setLocationError(null);
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setLocationError('Enable location services to see nearby photographers.');
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Allow location access to find photographers near you.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = position.coords;
      setUserMarker({
        id: 'user-location',
        title: 'You',
        description: 'Current location',
        latitude,
        longitude,
        type: 'user',
      });
      const geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
      const place = geocode[0];
      if (place) {
        const label = [place.subregion, place.city, place.region].filter(Boolean).join(', ');
        setResolvedLocation(label || 'Location updated');
      } else {
        setResolvedLocation('Location updated');
      }
    } catch (err) {
      console.warn('Location request failed', err);
      setLocationError('Unable to get your location right now. Try again.');
    } finally {
      setRequesting(false);
    }
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const searchArea = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    setSearching(true);
    setLocationError(null);
    try {
      const results = await Location.geocodeAsync(query);
      const best = results[0];
      if (!best) {
        setLocationError('No matching area found. Try a different suburb or city.');
        return;
      }
      setUserMarker({
        id: 'search-location',
        title: 'Search area',
        description: query,
        latitude: best.latitude,
        longitude: best.longitude,
        type: 'user',
      });
      setResolvedLocation(query);
    } catch (err) {
      console.warn('Search location failed', err);
      setLocationError('Unable to search area right now.');
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.mapWrapper}>
          <MapPreview markers={markers} />
          <View style={styles.searchOverlay}>
            <Ionicons name="search" size={18} color="#475569" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search your area..."
              style={styles.searchInput}
              placeholderTextColor="#94a3b8"
              returnKeyType="search"
              onSubmitEditing={searchArea}
            />
            <TouchableOpacity onPress={searchArea} disabled={searching}>
              <Text style={styles.searchCta}>{searching ? '...' : 'Go'}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.locationFab} onPress={requestLocation} disabled={requesting}>
            <Ionicons name="locate" size={22} color="#0f172a" />
          </TouchableOpacity>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Photographers near you</Text>
              {resolvedLocation ? <Text style={styles.sheetMeta}>{resolvedLocation}</Text> : null}
            </View>
            {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}
            {recommendations.length === 0 ? (
              <Text style={styles.emptyText}>No nearby photographers yet. Try another area.</Text>
            ) : (
              <FlatList
                horizontal
                data={recommendations}
                keyExtractor={({ photographer }) => photographer.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cardRow}
                renderItem={({ item }) => {
                  const estimate = quotePaparazziSession(
                    item.photographer,
                    item.score.distanceKm,
                    4,
                    localeCurrency
                  );
                  return (
                    <TouchableOpacity
                      style={styles.photographerCard}
                      onPress={() => navigation.navigate('Profile', { photographerId: item.photographer.id })}
                    >
                      <Text style={styles.recommendName} numberOfLines={1}>
                        {item.photographer.name}
                      </Text>
                      <Text style={styles.recommendMeta} numberOfLines={1}>
                        {item.photographer.location}
                      </Text>
                      <Text style={styles.recommendMeta}>⭐ {item.photographer.rating.toFixed(1)}</Text>
                      <Text style={styles.recommendPrice}>
                        {formatCurrency(estimate.total, estimate.currency)}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
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
  },
  mapWrapper: {
    flex: 1,
    width: '100%',
    minHeight: 480,
  },
  searchOverlay: {
    position: 'absolute',
    top: 6,
    left: 12,
    right: 12,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: '#0f172a',
    fontWeight: '600',
  },
  searchCta: {
    color: '#0f172a',
    fontWeight: '800',
  },
  locationFab: {
    position: 'absolute',
    right: 14,
    bottom: 208,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    paddingTop: 12,
    paddingBottom: 14,
  },
  sheetHeader: {
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  sheetTitle: {
    fontWeight: '800',
    color: '#0f172a',
    fontSize: 16,
  },
  sheetMeta: {
    color: '#475569',
    marginTop: 2,
  },
  cardRow: {
    paddingHorizontal: 14,
    gap: 10,
  },
  photographerCard: {
    width: 210,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    padding: 12,
    backgroundColor: '#f8fafc',
  },
  recommendName: {
    fontWeight: '700',
    color: '#0f172a',
    fontSize: 15,
  },
  recommendMeta: {
    color: '#475569',
    marginTop: 2,
  },
  recommendPrice: {
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 8,
  },
  errorText: {
    color: '#dc2626',
    fontWeight: '700',
    marginHorizontal: 14,
    marginBottom: 4,
  },
  emptyText: {
    color: '#475569',
    marginHorizontal: 14,
    marginTop: 6,
  },
});

export default MapScreen;
