import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { MapPreview } from '../components/MapPreview';
import { MapMarker } from '../components/mapTypes';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import { RequestPopup } from '../components/RequestPopup';
import { supabase } from '../config/supabaseClient';
import { BOOKING_PACKAGES } from '../constants/pricing';
import { haversineDistanceKm } from '../utils/geo';
const SA_BOUNDS = {
  minLat: -35,
  maxLat: -22,
  minLng: 16,
  maxLng: 33,
};

const isWithinSouthAfrica = (latitude: number, longitude: number) =>
  latitude >= SA_BOUNDS.minLat &&
  latitude <= SA_BOUNDS.maxLat &&
  longitude >= SA_BOUNDS.minLng &&
  longitude <= SA_BOUNDS.maxLng;

const formatAccuracy = (accuracy?: number | null) => {
  if (!accuracy) return 'Approximate position';
  if (accuracy > 250) return `Weak GPS (~${Math.round(accuracy)}m)`;
  if (accuracy > 75) return `Accurate to ~${Math.round(accuracy)}m`;
  return 'High accuracy lock';
};

type UserCoordinates = {
  lat: number;
  lng: number;
  timestamp: number;
};

const formatTimestamp = (timestamp: number) => {
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch (_err) {
    return 'recently';
  }
};

const MapScreen: React.FC = () => {
  const { state } = useAppData();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [userMarker, setUserMarker] = useState<MapMarker | null>(null);
  const [userCoordinates, setUserCoordinates] = useState<UserCoordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [usingManual, setUsingManual] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [manualLocation, setManualLocation] = useState({ label: '', latitude: '', longitude: '' });
  const [gpsEnabled, setGpsEnabled] = useState<boolean | null>(null);
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null);
  
  // Uber request states
  const [incomingRequest, setIncomingRequest] = useState<any | null>(null);
  const [showPopup, setShowPopup] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false); // For Clients sending requests

  const lastRequestRef = useRef<number>(0);
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Root'>>();
  const currentUser = state.currentUser;

  const baseMarkers: MapMarker[] = useMemo(() => {
    let result: MapMarker[] = [];
    const role = currentUser?.role || 'client';

    if (role === 'photographer') {
      // Photographers see Models (Users/Clients typically don't have public coords unless they opt in, but models do)
      result = [
        ...state.models.map(m => ({
          id: m.id,
          title: m.name,
          description: 'Model looking to shoot',
          latitude: m.latitude,
          longitude: m.longitude,
          type: 'model' as const,
        }))
      ];
    } else if (role === 'model') {
      // Models see Photographers
      result = [
        ...state.photographers.map(p => ({
          id: p.id,
          title: p.name,
          description: p.location,
          latitude: p.latitude,
          longitude: p.longitude,
          type: 'photographer' as const,
        }))
      ];
    } else {
      // Clients see Photographers and Models
      result = [
        ...state.photographers.map(p => ({
          id: p.id, title: p.name, description: 'Photographer', latitude: p.latitude, longitude: p.longitude, type: 'photographer' as const
        })),
        ...state.models.map(m => ({
          id: m.id, title: m.name, description: 'Model', latitude: m.latitude, longitude: m.longitude, type: 'model' as const
        }))
      ];
    }
    return result;
  }, [state.photographers, state.models, currentUser]);

  const filteredBaseMarkers: MapMarker[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return baseMarkers;
    return baseMarkers.filter((marker) => {
      const title = marker.title ?? '';
      const description = marker.description ?? '';
      return (
        title.toLowerCase().includes(q) ||
        description.toLowerCase().includes(q)
      );
    });
  }, [baseMarkers, searchQuery]);

  const markers: MapMarker[] = useMemo(
    () => (userMarker ? [userMarker, ...filteredBaseMarkers] : filteredBaseMarkers),
    [filteredBaseMarkers, userMarker]
  );

  const handleLocationFailure = useCallback((message: string) => {
    setLocationError(message);
    setUserMarker(null);
    setUserCoordinates(null);
  }, []);

  const requestLocation = useCallback(async () => {
    const now = Date.now();
    if (now - lastRequestRef.current < 750) return; // debounce rapid taps
    lastRequestRef.current = now;

    setRequesting(true);
    setLocationError(null);
    setLocationWarning(null);
    setUsingManual(false);
    setShowManualEntry(false);

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      setGpsEnabled(servicesEnabled);
      if (!servicesEnabled) {
        handleLocationFailure('Location services are off. Enable GPS or enter your location manually.');
        return;
      }

      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        const message = canAskAgain
          ? 'Location permission is required to show nearby photographers.'
          : 'Location permission denied. Please enable it in settings or enter your location manually.';
        handleLocationFailure(message);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
        mayShowUserSettingsDialog: true,
      });

      const { latitude, longitude, accuracy } = position.coords;
      if (!isWithinSouthAfrica(latitude, longitude)) {
        handleLocationFailure('We currently support South African locations only. Enter a supported location manually.');
        return;
      }

      if (accuracy && accuracy > 120) {
        setLocationWarning('GPS signal is weak; location is approximate.');
      }

      setUserMarker({
        id: 'user-location',
        title: 'You',
        description: formatAccuracy(accuracy),
        latitude,
        longitude,
        type: 'user',
      });
      setUserCoordinates({ lat: latitude, lng: longitude, timestamp: position.timestamp });
    } catch (_err) {
      handleLocationFailure('Unable to fetch GPS. Check connectivity or enter your location manually.');
    } finally {
      setRequesting(false);
    }
  }, [handleLocationFailure]);

  // Real-time listener for incoming Uber-like requests
  useEffect(() => {
    if (!currentUser?.id) return;
    const isModel = currentUser?.role === 'model';
    const filterColumn = isModel ? 'model_id' : 'photographer_id';
    const channel = supabase.channel(`public:bookings:${filterColumn}=eq.${currentUser.id}`);
    
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bookings', filter: `${filterColumn}=eq.${currentUser.id}` },
      (payload) => {
        if (payload.new.status === 'pending' && payload.new.user_latitude && payload.new.user_longitude) {
          const userLat = Number(payload.new.user_latitude);
          const userLng = Number(payload.new.user_longitude);
          let distanceLabel = '2.4 km';
          if (currentUser?.id) {
            const creator =
              currentUser.role === 'model'
                ? state.models.find((m) => m.id === currentUser.id)
                : state.photographers.find((p) => p.id === currentUser.id);
            if (creator?.latitude && creator?.longitude) {
              const km = haversineDistanceKm(
                { latitude: creator.latitude, longitude: creator.longitude },
                { latitude: userLat, longitude: userLng }
              );
              distanceLabel = `${km.toFixed(1)} km`;
            }
          }
          setIncomingRequest({ ...payload.new, distance: distanceLabel });
          setShowPopup(true);
        }
      }
    ).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser, state.models, state.photographers]);

  const handleRequestBooking = async (marker: MapMarker) => {
    if (!userCoordinates) {
      Alert.alert('Location required', 'We need your live GPS location to request talent nearby.');
      return;
    }
    setIsRequesting(true);
    try {
      const instantPackage = BOOKING_PACKAGES.find((pkg) => pkg.id === 'instant') ?? BOOKING_PACKAGES[0];
      const baseAmount = instantPackage.basePrice;
      const commissionAmount = Math.round(baseAmount * 0.3);
      const payoutAmount = baseAmount - commissionAmount;
      // Create a pending booking straight from the map
      const { error } = await supabase.from('bookings').insert({
        client_id: currentUser?.id,
        photographer_id: marker.type === 'photographer' ? marker.id : null,
        model_id: marker.type === 'model' ? marker.id : null,
        status: 'pending',
        package_type: instantPackage.label,
        user_latitude: userCoordinates.lat,
        user_longitude: userCoordinates.lng,
        booking_date: new Date().toISOString(),
        total_amount: baseAmount,
        payout_amount: payoutAmount,
        commission_amount: commissionAmount
      });

      if (error) throw error;
      Alert.alert('Request sent', `Waiting for ${marker.title} to accept...`);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsRequesting(false);
      setSelectedMarker(null);
    }
  };

  const handleAcceptIncoming = async () => {
    if (!incomingRequest) return;
    try {
      const { error } = await supabase.from('bookings').update({ status: 'accepted' }).eq('id', incomingRequest.id);
      if (error) throw error;
      setShowPopup(false);
      Alert.alert('Accepted!', 'You have confirmed the booking request.');
      navigation.navigate('Root', { screen: 'Bookings' });
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleDeclineIncoming = async () => {
    if (!incomingRequest) return;
    try {
      await supabase.from('bookings').update({ status: 'declined' }).eq('id', incomingRequest.id);
      setShowPopup(false);
    } catch (err: any) {
      console.warn(err);
      setShowPopup(false);
    }
  };

  const applyManualLocation = useCallback(() => {
    const latitude = parseFloat(manualLocation.latitude);
    const longitude = parseFloat(manualLocation.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      Alert.alert('Invalid coordinates', 'Please enter numeric latitude and longitude values.');
      return;
    }
    if (!isWithinSouthAfrica(latitude, longitude)) {
      Alert.alert(
        'Out of bounds',
        'Coordinates must be inside South Africa (lat -35 to -22, lng 16 to 33).'
      );
      return;
    }

    setLocationError(null);
    setMapError(null);
    setUsingManual(true);
    setUserMarker({
      id: 'manual-location',
      title: manualLocation.label || 'Manual location',
      description: 'Pinned manually',
      latitude,
      longitude,
      type: 'user',
    });
    setUserCoordinates(null);
  }, [manualLocation.label, manualLocation.latitude, manualLocation.longitude]);

  const statusLabel = useMemo(() => {
    if (mapError) return 'Map offline · using manual entry';
    if (locationError) return 'Location needed';
    if (usingManual) return 'Manual location active';
    if (userMarker) return 'GPS locked';
    if (gpsEnabled === false) return 'GPS disabled';
    return 'Requesting location...';
  }, [gpsEnabled, locationError, mapError, userMarker, usingManual]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>Photographers nearby</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Search photographers by city or name, then tap markers to explore nearby talent.
              </Text>
              <Text style={[styles.status, { color: colors.text }]}>{statusLabel}</Text>
              <Text style={[styles.coordsLabel, { color: colors.textMuted }]}>
                {userCoordinates
                  ? `Lat ${userCoordinates.lat.toFixed(5)}, Lng ${userCoordinates.lng.toFixed(5)} · Updated ${formatTimestamp(
                      userCoordinates.timestamp
                    )}`
                  : 'Awaiting live GPS coordinates'}
              </Text>
              {locationWarning ? <Text style={styles.warning}>{locationWarning}</Text> : null}
              {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}
              {mapError ? <Text style={styles.errorText}>{mapError}</Text> : null}
            </View>
            <View style={[styles.countPill, { backgroundColor: colors.accent }]}>
              <Text style={[styles.countText, { color: isDark ? colors.bg : '#fff' }]}>{baseMarkers.length}</Text>
              <Text style={[styles.countLabel, { color: isDark ? colors.bg + '80' : 'rgba(255,255,255,0.7)' }]}>active</Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.accent }]} onPress={requestLocation} disabled={requesting}>
              <Text style={[styles.primaryButtonText, { color: isDark ? colors.bg : '#fff' }]}>{requesting ? 'Requesting...' : 'Retry GPS'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: colors.card, borderColor: colors.border }, usingManual && [styles.secondaryButtonActive, { borderColor: colors.accent, backgroundColor: colors.accent + '10' }]]}
              onPress={() => setShowManualEntry((current) => !current)}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }, usingManual && [styles.secondaryButtonTextActive, { color: colors.accent }]]}>
                {showManualEntry ? 'Hide manual pin' : 'Manual pin'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              placeholder="Search photographers or city"
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            />
            <Text style={[styles.searchMeta, { color: colors.textSecondary }]}>{filteredBaseMarkers.length} shown</Text>
          </View>

          <View style={styles.mapWrapper}>
            <MapPreview
              markers={markers}
              onMapError={(message) => setMapError(message)}
              onMarkerPress={(m) => {
                if (m.type === 'photographer' || m.type === 'model') {
                  setSelectedMarker(m);
                }
              }}
            />
            
            {selectedMarker && (
              <View style={[styles.bottomSheet, { backgroundColor: colors.card }]}>
                <TouchableOpacity style={styles.closeSheet} onPress={() => setSelectedMarker(null)}>
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
                <View style={styles.sheetHeader}>
                  <View style={[styles.sheetPhotoPlaceholder, { backgroundColor: colors.bg }]}>
                    <Ionicons name="camera" size={24} color={colors.textMuted} />
                  </View>
                  <View style={styles.sheetInfo}>
                    <Text style={[styles.sheetTitle, { color: colors.text }]}>{selectedMarker.title}</Text>
                    <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>{selectedMarker.description}</Text>
                    <View style={styles.ratingRow}>
                      <Ionicons name="star" size={14} color="#fbbf24" />
                      <Text style={[styles.ratingText, { color: colors.text }]}>4.9 (120+ trips)</Text>
                    </View>
                  </View>
                </View>
                  {currentUser?.role === 'client' && (
                    <TouchableOpacity
                      style={[styles.bookButton, { backgroundColor: colors.accent, marginTop: 10 }]}
                      onPress={() => handleRequestBooking(selectedMarker)}
                      disabled={isRequesting}
                    >
                      <Text style={[styles.bookButtonText, { color: isDark ? colors.bg : '#fff' }]}>
                        {isRequesting ? 'Requesting...' : 'Request Now (Uber Fast)'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
            )}
          </View>

          {showManualEntry ? (
            <View style={[styles.manualCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.manualTitle, { color: colors.text }]}>Manual fallback</Text>
              <Text style={[styles.manualSubtitle, { color: colors.textSecondary }]}>
                Use only if GPS fails. South Africa bounds: lat -35 to -22, lng 16 to 33.
              </Text>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Label</Text>
                  <TextInput
                    placeholder="Cape Town CBD"
                    placeholderTextColor={colors.textMuted}
                    value={manualLocation.label}
                    onChangeText={(text) => setManualLocation((prev) => ({ ...prev, label: text }))}
                    style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }]}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Latitude</Text>
                  <TextInput
                    placeholder="-33.92"
                    placeholderTextColor={colors.textMuted}
                    value={manualLocation.latitude}
                    onChangeText={(text) => setManualLocation((prev) => ({ ...prev, latitude: text }))}
                    style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }]}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Longitude</Text>
                  <TextInput
                    placeholder="18.42"
                    placeholderTextColor={colors.textMuted}
                    value={manualLocation.longitude}
                    onChangeText={(text) => setManualLocation((prev) => ({ ...prev, longitude: text }))}
                    style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }]}
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <TouchableOpacity style={[styles.applyButton, { backgroundColor: colors.accent }]} onPress={applyManualLocation}>
                <Text style={[styles.applyButtonText, { color: isDark ? colors.bg : '#fff' }]}>Pin manual location</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Incoming Request Uber-Popup */}
          <RequestPopup
            visible={showPopup}
            requestData={incomingRequest}
            onAccept={handleAcceptIncoming}
            onDecline={handleDeclineIncoming}
          />
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
  },
  status: {
    fontWeight: '700',
  },
  coordsLabel: {
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
  },
  warning: {
    color: '#b45309',
    fontWeight: '700',
    marginTop: 4,
  },
  errorText: {
    color: '#dc2626',
    fontWeight: '700',
    marginTop: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  countPill: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  countText: {
    fontWeight: '800',
    fontSize: 16,
  },
  countLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  primaryButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButtonText: {
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryButtonActive: {
  },
  secondaryButtonText: {
    fontWeight: '700',
  },
  secondaryButtonTextActive: {
  },
  mapWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchMeta: {
    fontWeight: '700',
  },
  manualCard: {
    marginTop: 12,
    borderRadius: 14,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  manualTitle: {
    fontWeight: '800',
  },
  manualSubtitle: {
    marginTop: 4,
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  inputGroup: {
    flex: 1,
    minWidth: 110,
  },
  label: {
    fontWeight: '700',
    marginBottom: 4,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10,
  },
  applyButton: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyButtonText: {
    fontWeight: '800',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 10,
  },
  closeSheet: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 11,
    padding: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetPhotoPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  sheetInfo: {
    flex: 1,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  sheetSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  bookButton: {
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 14,
  },
  bookButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});

export default MapScreen;
