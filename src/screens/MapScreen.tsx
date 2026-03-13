import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { MapPreview } from '../components/MapPreview';
import { MapMarker } from '../components/mapTypes';
import { RequestPopup } from '../components/RequestPopup';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { RootStackParamList } from '../navigation/types';
import { BOOKING_PACKAGES } from '../constants/pricing';
import { haversineDistanceKm } from '../utils/geo';
import { supabase } from '../config/supabaseClient';

MapLibreGL.setTelemetryEnabled(false);

const MAP_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

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

const buildRoute = (
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  steps: number,
  offset: number
) => {
  const coords: Array<{ lat: number; lng: number }> = [];
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    coords.push({
      lat: start.lat + dy * t + offset * Math.sin(t * Math.PI),
      lng: start.lng + dx * t + offset * Math.cos(t * Math.PI),
    });
  }
  return coords;
};

const sliceRoute = (coords: Array<{ lat: number; lng: number }>, progress: number) => {
  if (coords.length < 2) return coords;
  const target = Math.max(2, Math.floor(coords.length * progress));
  return coords.slice(0, Math.min(coords.length, target));
};

const MapScreen: React.FC = () => {
  const { state } = useAppData();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Root'>>();
  const currentUser = state.currentUser;

  const [userMarker, setUserMarker] = useState<MapMarker | null>(null);
  const [userCoordinates, setUserCoordinates] = useState<UserCoordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualLocation, setManualLocation] = useState({ label: '', latitude: '', longitude: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null);

  const [incomingRequest, setIncomingRequest] = useState<any | null>(null);
  const [showPopup, setShowPopup] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  const lastRequestRef = useRef<number>(0);
  const cameraRef = useRef<MapLibreGL.Camera>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const [routeProgress, setRouteProgress] = useState(0);

  useEffect(() => {
    Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    ).start();
  }, [pulse]);

  const baseMarkers: MapMarker[] = useMemo(() => {
    let result: MapMarker[] = [];
    const role = currentUser?.role || 'client';

    if (role === 'photographer') {
      result = state.models.map((m) => ({
        id: `model-${m.id}`,
        sourceId: m.id,
        title: m.name,
        description: 'Model',
        latitude: m.latitude,
        longitude: m.longitude,
        type: 'model',
      }));
    } else if (role === 'model') {
      result = state.photographers.map((p) => ({
        id: `photographer-${p.id}`,
        sourceId: p.id,
        title: p.name,
        description: 'Photographer',
        latitude: p.latitude,
        longitude: p.longitude,
        type: 'photographer',
      }));
    } else {
      const photographerMarkers = state.photographers.map((p) => ({
        id: `photographer-${p.id}`,
        sourceId: p.id,
        title: p.name,
        description: 'Photographer',
        latitude: p.latitude,
        longitude: p.longitude,
        type: 'photographer',
      }));
      const modelMarkers = state.models.map((m) => ({
        id: `model-${m.id}`,
        sourceId: m.id,
        title: m.name,
        description: 'Model',
        latitude: m.latitude,
        longitude: m.longitude,
        type: 'model',
      }));
      result = [...photographerMarkers, ...modelMarkers];
    }

    const seen = new Set<string>();
    return result.filter((marker) => {
      if (seen.has(marker.id)) return false;
      seen.add(marker.id);
      return true;
    });
  }, [state.photographers, state.models, currentUser]);

  const filteredBaseMarkers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return baseMarkers;
    return baseMarkers.filter((marker) => {
      const title = marker.title ?? '';
      const description = marker.description ?? '';
      return title.toLowerCase().includes(q) || description.toLowerCase().includes(q);
    });
  }, [baseMarkers, searchQuery]);

  const markers = useMemo(() => (userMarker ? [userMarker, ...filteredBaseMarkers] : filteredBaseMarkers), [filteredBaseMarkers, userMarker]);

  const mapCenter = useMemo(() => {
    if (userCoordinates) return [userCoordinates.lng, userCoordinates.lat];
    if (markers[0]) return [markers[0].longitude, markers[0].latitude];
    return [18.4241, -33.9249];
  }, [markers, userCoordinates]);

  const handleLocationFailure = useCallback((message: string) => {
    setLocationError(message);
    setUserMarker(null);
    setUserCoordinates(null);
  }, []);

  const requestLocation = useCallback(async () => {
    const now = Date.now();
    if (now - lastRequestRef.current < 750) return;
    lastRequestRef.current = now;

    setRequesting(true);
    setLocationError(null);
    setLocationWarning(null);
    setShowManualEntry(false);

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        handleLocationFailure('Location services are off. Enable GPS or enter your location manually.');
        return;
      }

      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        const message = canAskAgain
          ? 'Location permission is required to show nearby talent.'
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
        id: `user-${currentUser?.id ?? 'location'}`,
        title: 'You',
        description: formatAccuracy(accuracy),
        latitude,
        longitude,
        type: 'user',
      });
      setUserCoordinates({ lat: latitude, lng: longitude, timestamp: position.timestamp });
      cameraRef.current?.setCamera({
        centerCoordinate: [longitude, latitude],
        zoomLevel: 12,
        animationMode: 'flyTo',
        animationDuration: 800,
      });
    } catch (_err) {
      handleLocationFailure('Unable to fetch GPS. Check connectivity or enter your location manually.');
    } finally {
      setRequesting(false);
    }
  }, [currentUser, handleLocationFailure]);

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
      const providerId = marker.sourceId ?? marker.id;
      const isModel = marker.type === 'model';

      const { error } = await supabase.from('bookings').insert({
        client_id: currentUser?.id,
        photographer_id: isModel ? null : providerId,
        model_id: isModel ? providerId : null,
        status: 'pending',
        package_type: `${instantPackage.label} (${marker.type})`,
        user_latitude: userCoordinates.lat,
        user_longitude: userCoordinates.lng,
        booking_date: new Date().toISOString(),
        price_total: baseAmount,
        photographer_payout: payoutAmount,
        commission_amount: commissionAmount,
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
    } catch (_err) {
      setShowPopup(false);
    }
  };

  const applyManualLocation = useCallback(() => {
    const latitude = parseFloat(manualLocation.latitude);
    const longitude = parseFloat(manualLocation.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      Alert.alert('Invalid coordinates', 'Enter valid latitude and longitude.');
      return;
    }
    if (!isWithinSouthAfrica(latitude, longitude)) {
      Alert.alert('Outside service area', 'Use a location inside South Africa.');
      return;
    }
    setUserMarker({
      id: `user-${currentUser?.id ?? 'manual'}`,
      title: manualLocation.label || 'Manual pin',
      description: 'Manual location',
      latitude,
      longitude,
      type: 'user',
    });
    setUserCoordinates({ lat: latitude, lng: longitude, timestamp: Date.now() });
    setShowManualEntry(false);
  }, [currentUser, manualLocation.label, manualLocation.latitude, manualLocation.longitude]);

  const primaryRoute = useMemo(() => {
    if (!selectedMarker || !userCoordinates) return [];
    return buildRoute(
      { lat: userCoordinates.lat, lng: userCoordinates.lng },
      { lat: selectedMarker.latitude, lng: selectedMarker.longitude },
      48,
      0
    );
  }, [selectedMarker, userCoordinates]);

  const altRoute = useMemo(() => {
    if (!selectedMarker || !userCoordinates) return [];
    return buildRoute(
      { lat: userCoordinates.lat, lng: userCoordinates.lng },
      { lat: selectedMarker.latitude, lng: selectedMarker.longitude },
      42,
      0.003
    );
  }, [selectedMarker, userCoordinates]);

  useEffect(() => {
    if (primaryRoute.length < 2) {
      setRouteProgress(0);
      return;
    }
    let raf: number | null = null;
    const start = Date.now();
    const duration = 1200;

    const tick = () => {
      const elapsed = Date.now() - start;
      const nextProgress = Math.min(1, elapsed / duration);
      setRouteProgress(nextProgress);
      if (nextProgress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [primaryRoute.length]);

  const primarySlice = useMemo(() => sliceRoute(primaryRoute, routeProgress), [primaryRoute, routeProgress]);
  const altSlice = useMemo(() => sliceRoute(altRoute, routeProgress), [altRoute, routeProgress]);

  const primaryGeoJson = useMemo(() => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: primarySlice.map((point) => [point.lng, point.lat]),
    },
    properties: {},
  }), [primarySlice]);

  const altGeoJson = useMemo(() => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: altSlice.map((point) => [point.lng, point.lat]),
    },
    properties: {},
  }), [altSlice]);

  const selectedDistance = useMemo(() => {
    if (!selectedMarker || !userCoordinates) return null;
    const km = haversineDistanceKm(
      { latitude: userCoordinates.lat, longitude: userCoordinates.lng },
      { latitude: selectedMarker.latitude, longitude: selectedMarker.longitude }
    );
    return `${km.toFixed(1)} km`;
  }, [selectedMarker, userCoordinates]);

  const etaLabel = useMemo(() => {
    if (!selectedDistance) return null;
    const km = parseFloat(selectedDistance);
    if (Number.isNaN(km)) return null;
    const minutes = Math.max(6, Math.round(km * 3.4));
    return `${minutes} min`;
  }, [selectedDistance]);

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.webContainer, { backgroundColor: colors.bg }]}>
        <MapPreview markers={markers} onMapError={(message) => setMapError(message)} />
        {mapError ? <Text style={styles.overlayError}>{mapError}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapLibreGL.MapView
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE_URL}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          centerCoordinate={mapCenter as [number, number]}
          zoomLevel={11.5}
          animationMode="flyTo"
          animationDuration={600}
        />

        {altSlice.length > 1 && (
          <MapLibreGL.ShapeSource id="route-alt" shape={altGeoJson as any}>
            <MapLibreGL.LineLayer
              id="route-alt-line"
              style={{
                lineColor: '#0f172a',
                lineOpacity: 0.25,
                lineWidth: 4,
                lineDasharray: [1.5, 2],
              }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {primarySlice.length > 1 && (
          <MapLibreGL.ShapeSource id="route-primary" shape={primaryGeoJson as any}>
            <MapLibreGL.LineLayer
              id="route-primary-line"
              style={{
                lineColor: '#3b82f6',
                lineOpacity: 0.9,
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {markers
          .filter((marker) => marker.type !== 'user')
          .map((marker) => (
            <MapLibreGL.PointAnnotation
              id={marker.id}
              key={marker.id}
              coordinate={[marker.longitude, marker.latitude]}
              onSelected={() => setSelectedMarker(marker)}
            >
              <View style={[styles.markerPin, marker.type === 'model' ? styles.modelPin : styles.photoPin]}>
                <Ionicons name={marker.type === 'model' ? 'sparkles' : 'camera'} size={14} color="#fff" />
              </View>
            </MapLibreGL.PointAnnotation>
          ))}

        {userMarker && (
          <MapLibreGL.PointAnnotation
            id={userMarker.id}
            key={userMarker.id}
            coordinate={[userMarker.longitude, userMarker.latitude]}
          >
            <View style={styles.userPinWrapper}>
              <Animated.View
                style={[
                  styles.userPulse,
                  {
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.4] }) }],
                  },
                ]}
              />
              <View style={styles.userPinCore} />
            </View>
          </MapLibreGL.PointAnnotation>
        )}
      </MapLibreGL.MapView>

      <SafeAreaView style={[styles.safeOverlay, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.topBar, { backgroundColor: colors.card }]}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              placeholder="Search photographers or models"
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
          <TouchableOpacity style={styles.iconButton} onPress={requestLocation} disabled={requesting}>
            <Ionicons name="locate" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.statusPill}>
          <Text style={[styles.statusTitle, { color: colors.text }]}>Live Map</Text>
          <Text style={[styles.statusSubtitle, { color: colors.textSecondary }]}>
            {userCoordinates
              ? `Lat ${userCoordinates.lat.toFixed(4)}, Lng ${userCoordinates.lng.toFixed(4)} - Updated ${formatTimestamp(
                  userCoordinates.timestamp
                )}`
              : 'Tap locate to fetch your position'}
          </Text>
          {locationWarning ? <Text style={styles.warning}>{locationWarning}</Text> : null}
          {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}
        </View>
      </SafeAreaView>

      <View style={[styles.bottomSheet, { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 16) }]}>
        {selectedMarker ? (
          <>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetAvatar}>
                <Ionicons name={selectedMarker.type === 'model' ? 'sparkles' : 'camera'} size={20} color={colors.textMuted} />
              </View>
              <View style={styles.sheetInfo}>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>{selectedMarker.title}</Text>
                <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>{selectedMarker.description}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedMarker(null)}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.sheetMetrics}>
              <View style={styles.metricItem}>
                <Text style={[styles.metricLabel, { color: colors.textMuted }]}>Distance</Text>
                <Text style={[styles.metricValue, { color: colors.text }]}>{selectedDistance ?? '—'}</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricLabel, { color: colors.textMuted }]}>ETA</Text>
                <Text style={[styles.metricValue, { color: colors.text }]}>{etaLabel ?? '—'}</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricLabel, { color: colors.textMuted }]}>Status</Text>
                <Text style={[styles.metricValue, { color: colors.text }]}>Available</Text>
              </View>
            </View>

            {currentUser?.role === 'client' && (
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.accent }]}
                onPress={() => handleRequestBooking(selectedMarker)}
                disabled={isRequesting}
              >
                <Text style={[styles.primaryButtonText, { color: isDark ? colors.bg : '#fff' }]}>
                  {isRequesting ? 'Requesting...' : 'Request Booking'}
                </Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Tap a pin to view details</Text>
            <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
              {filteredBaseMarkers.length} talents available in your area.
            </Text>
          </>
        )}

        <View style={styles.manualRow}>
          <TouchableOpacity onPress={() => setShowManualEntry((current) => !current)}>
            <Text style={[styles.manualToggle, { color: colors.accent }]}>
              {showManualEntry ? 'Hide manual pin' : 'Enter location manually'}
            </Text>
          </TouchableOpacity>
        </View>

        {showManualEntry ? (
          <View style={[styles.manualCard, { borderColor: colors.border }]}>
            <View style={styles.manualInputs}>
              <TextInput
                placeholder="Label"
                placeholderTextColor={colors.textMuted}
                value={manualLocation.label}
                onChangeText={(text) => setManualLocation((prev) => ({ ...prev, label: text }))}
                style={[styles.manualInput, { color: colors.text, borderColor: colors.border }]}
              />
              <TextInput
                placeholder="Latitude"
                placeholderTextColor={colors.textMuted}
                value={manualLocation.latitude}
                onChangeText={(text) => setManualLocation((prev) => ({ ...prev, latitude: text }))}
                keyboardType="numeric"
                style={[styles.manualInput, { color: colors.text, borderColor: colors.border }]}
              />
              <TextInput
                placeholder="Longitude"
                placeholderTextColor={colors.textMuted}
                value={manualLocation.longitude}
                onChangeText={(text) => setManualLocation((prev) => ({ ...prev, longitude: text }))}
                keyboardType="numeric"
                style={[styles.manualInput, { color: colors.text, borderColor: colors.border }]}
              />
            </View>
            <TouchableOpacity style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={applyManualLocation}>
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Pin location</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <RequestPopup visible={showPopup} requestData={incomingRequest} onAccept={handleAcceptIncoming} onDecline={handleDeclineIncoming} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  safeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  topBar: {
    marginHorizontal: 16,
    padding: 10,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 4,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    marginTop: 10,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
  },
  statusTitle: {
    fontWeight: '700',
    fontSize: 14,
  },
  statusSubtitle: {
    fontSize: 12,
    marginTop: 4,
  },
  warning: {
    color: '#f59e0b',
    fontSize: 12,
    marginTop: 4,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    marginTop: 4,
  },
  bottomSheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    padding: 16,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetInfo: {
    flex: 1,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  sheetSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  sheetMetrics: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricItem: {
    alignItems: 'flex-start',
  },
  metricLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  primaryButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontWeight: '700',
    fontSize: 16,
  },
  manualRow: {
    marginTop: 12,
    alignItems: 'flex-end',
  },
  manualToggle: {
    fontSize: 12,
    fontWeight: '600',
  },
  manualCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  manualInputs: {
    gap: 8,
  },
  manualInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secondaryButton: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontWeight: '600',
  },
  markerPin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  modelPin: {
    backgroundColor: '#ec4899',
  },
  photoPin: {
    backgroundColor: '#111827',
  },
  userPinWrapper: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userPinCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#3b82f6',
    borderWidth: 3,
    borderColor: '#dbeafe',
  },
  userPulse: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#3b82f6',
  },
  webContainer: {
    flex: 1,
    padding: 16,
  },
  overlayError: {
    color: '#ef4444',
    marginTop: 8,
  },
});

export default MapScreen;


