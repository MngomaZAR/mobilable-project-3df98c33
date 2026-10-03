import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { Booking } from '../types';
import { useAppData } from '../store/AppDataContext';
import { validateSouthAfricanLocation } from '../utils/geo';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';
import { environment } from '../config/environment';
import { MapLibreGL, isMapLibreNativeAvailable } from '../components/MapLibreWrapper';
import { useTheme } from '../store/ThemeContext';
import { routingService, RouteResponse } from '../services/routingService';

type Route = RouteProp<RootStackParamList, 'BookingTracking'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingTracking'>;

const MAP_STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

type LocationFix = {
  booking_id: string; user_id: string; role: 'client' | 'provider';
  latitude: number; longitude: number; accuracy_m: number; created_at: string; expires_at: string;
};
type LocationSnapshot = {
  booking_id: string; locations: LocationFix[]; tracking_window_start: string; tracking_window_end: string;
};

const isFreshFix = (fix: LocationFix, now: number) =>
  Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude) && validateSouthAfricanLocation(fix.latitude, fix.longitude)
  && Number.isFinite(fix.accuracy_m) && fix.accuracy_m > 0 && fix.accuracy_m <= 100
  && Date.parse(fix.created_at) <= now && now - Date.parse(fix.created_at) < 300000 && Date.parse(fix.expires_at) > now;

const toStatusLabel = (status: Booking['status']) => {
  if (status === 'accepted') return 'Accepted';
  if (status === 'in_progress') return 'In Progress';
  if (status === 'pending') return 'Pending';
  if (status === 'completed') return 'Complete';
  if (status === 'paid_out') return 'Paid Out';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'declined') return 'Declined';
  return String(status ?? 'Unknown');
};

const formatTimer = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const BookingTrackingScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { state, startConversationWithUser, updateBookingClientLocation, updatePhotographerLocation, updateBookingStatus, refresh } = useAppData();
  const cameraRef = useRef<any>(null);
  const pulse = useRef(new Animated.Value(0)).current;

  const booking = useMemo(
    () => state.bookings.find((item) => item.id === params.bookingId),
    [params.bookingId, state.bookings]
  );
  const provider = useMemo(
    () => booking?.model_id ? state.models.find(p => p.id === booking.model_id) : state.photographers.find(p => p.id === booking?.photographer_id),
    [booking?.model_id, booking?.photographer_id, state.models, state.photographers]
  );
  const [snapshot, setSnapshot] = useState<LocationSnapshot | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [trackingRoute, setTrackingRoute] = useState<RouteResponse | null>(null);
  const usesApi = environment.backendProvider === 'api';
  const providerId = booking?.model_id || booking?.photographer_id;
  const isClient = state.currentUser?.id === booking?.client_id;
  const isProvider = state.currentUser?.id === providerId;
  const start = Date.parse(booking?.start_datetime ?? '');
  const end = Date.parse(booking?.end_datetime ?? '');
  const trackingAllowed = usesApi && booking?.payment_status === 'paid'
    && ['accepted', 'in_progress'].includes(booking.status) && end > start && end - start <= 43200000
    && start - 7200000 <= now && now < end;
  const trackingEnabled = trackingAllowed && snapshot?.booking_id === booking?.id
    && Date.parse(snapshot!.tracking_window_start) <= now && now < Date.parse(snapshot!.tracking_window_end);
  const liveClientLocation = trackingEnabled ? snapshot?.locations.find(fix => fix.role === 'client' && fix.user_id === booking?.client_id && isFreshFix(fix, now)) ?? null : null;
  const livePhotographerLocation = trackingEnabled ? snapshot?.locations.find(fix => fix.role === 'provider' && fix.user_id === providerId && isFreshFix(fix, now)) ?? null : null;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    setSnapshot(null);
    setTrackingError(null);
    if (!trackingAllowed || !booking?.id || !state.currentUser?.id) return;
    let mounted = true;
    let loading = false;
    const readSnapshot = async () => {
      if (loading) return;
      loading = true;
      try {
        const token = await getApiAccessToken();
        const next = await apiClient.get<LocationSnapshot>(`/bookings/${encodeURIComponent(booking.id)}/location`, { token });
        if (mounted && next.booking_id === booking.id) { setSnapshot(next); setTrackingError(null); }
      } catch (error: any) {
        if (mounted) { setSnapshot(null); setTrackingError(error.message || 'Live location unavailable.'); }
      } finally { loading = false; }
    };
    void readSnapshot();
    const timer = setInterval(readSnapshot, 6000);
    return () => { mounted = false; clearInterval(timer); };
  }, [booking?.id, state.currentUser?.id, trackingAllowed]);

  useEffect(() => {
    if (!trackingEnabled || !booking?.id || !(isClient || isProvider)) return;
    let mounted = true;
    let watcher: Location.LocationSubscription | null = null;

    const startLiveTracking = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted' || !mounted) {
        if (mounted) setSharingError('Location permission is required to share your GPS fix.');
        return;
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 20,
          timeInterval: 7000,
        },
        async ({ coords }) => {
          if (!mounted) return;
          try {
            if (isClient) {
              await updateBookingClientLocation(booking.id, coords.latitude, coords.longitude, coords.accuracy ?? undefined);
            } else {
              await updatePhotographerLocation(coords.latitude, coords.longitude, booking.id, coords.accuracy ?? undefined);
            }
            if (mounted) setSharingError(null);
          } catch (error: any) {
            if (mounted) setSharingError(error.message || 'Unable to share your GPS fix.');
          }
        }
      );
      if (!mounted) subscription.remove();
      else watcher = subscription;
    };

    void startLiveTracking().catch(error => { if (mounted) setSharingError(error.message || 'GPS is unavailable.'); });

    return () => {
      mounted = false;
      watcher?.remove();
    };
  }, [booking?.id, trackingEnabled, isClient, isProvider, updateBookingClientLocation, updatePhotographerLocation]);

  useEffect(() => {
    let active = true;
    setTrackingRoute(null);
    if (!liveClientLocation || !livePhotographerLocation) return;

    const hydrateRoute = async () => {
      const route = await routingService.getRoute(livePhotographerLocation, liveClientLocation);
      if (!active) return;
      if (route.source !== 'fallback' && route.coordinates.length >= 2 && Number.isFinite(route.duration) && Number.isFinite(route.distance)) setTrackingRoute(route);
    };

    void hydrateRoute().catch(() => { if (active) setTrackingRoute(null); });
    return () => {
      active = false;
    };
  }, [
    liveClientLocation?.latitude,
    liveClientLocation?.longitude,
    livePhotographerLocation?.latitude,
    livePhotographerLocation?.longitude,
  ]);

  const openChatThread = async () => {
    const partnerId = isClient ? providerId : booking?.client_id;
    if (!partnerId) {
      navigation.navigate('Root', { screen: 'Chat' });
      return;
    }

    try {
      const convo = await startConversationWithUser(partnerId, isClient ? provider?.name ?? 'Creator' : 'Client');
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch {
      navigation.navigate('Root', { screen: 'Chat' });
    }
  };

  const cancelBooking = async () => {
    if (!booking) return;
    Alert.alert('Cancel Booking', 'Are you sure you want to cancel this booking?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            await updateBookingStatus(booking.id, 'cancelled');
            await refresh();
            navigation.goBack();
          } catch (err: any) {
            Alert.alert('Unable to cancel', err?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  };

  if (!booking) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={[styles.muted, { color: colors.textMuted }]}>We could not find that booking.</Text>
      </View>
    );
  }

  const knownLocations = [liveClientLocation, livePhotographerLocation].filter((fix): fix is LocationFix => fix !== null);
  const centerLat = knownLocations.length ? knownLocations.reduce((sum, fix) => sum + fix.latitude, 0) / knownLocations.length : null;
  const centerLng = knownLocations.length ? knownLocations.reduce((sum, fix) => sum + fix.longitude, 0) / knownLocations.length : null;
  const routeGeoJson = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: trackingRoute?.coordinates ?? [],
    },
    properties: {},
  };

  const hasRoadRoute = Boolean(liveClientLocation && livePhotographerLocation && trackingRoute && trackingRoute.source !== 'fallback' && trackingRoute.coordinates.length >= 2);
  const distanceKm = hasRoadRoute ? trackingRoute!.distance : null;
  const routeSourceLabel = hasRoadRoute ? 'Road route' : 'Navigation unavailable';
  const activeTimer = hasRoadRoute ? Math.round(trackingRoute!.duration) : null;
  const isCancellable = booking.status === 'pending' || booking.status === 'accepted' || booking.status === 'in_progress';
  const statusLabel = toStatusLabel(booking.status);
  const unavailableReason = !usesApi ? 'Live location unavailable.' : booking.payment_status !== 'paid' ? 'Payment required before live tracking.'
    : !trackingAllowed ? 'Live tracking is unavailable outside the paid shoot travel window.'
    : trackingError ?? (knownLocations.length === 0 ? 'Waiting for a fresh GPS fix.' : !liveClientLocation ? 'Client GPS unavailable.' : !livePhotographerLocation ? 'Creator GPS unavailable.' : null);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {isMapLibreNativeAvailable && centerLat !== null && centerLng !== null ? (
        <MapLibreGL.MapView
          style={StyleSheet.absoluteFill}
          mapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled
        >
          <MapLibreGL.Camera
            ref={cameraRef}
            centerCoordinate={[centerLng, centerLat]}
            zoomLevel={11}
            animationMode="flyTo"
            animationDuration={700}
          />

          {hasRoadRoute ? <MapLibreGL.ShapeSource id="track-route" shape={routeGeoJson as any}>
            <MapLibreGL.LineLayer
              id="track-route-glow"
              style={{
                lineColor: trackingRoute?.source === 'fallback' ? (isDark ? '#7b879b' : '#b8a78f') : (isDark ? '#f7d7a2' : '#e5c28b'),
                lineWidth: trackingRoute?.source === 'fallback' ? 8 : 12,
                lineOpacity: trackingRoute?.source === 'fallback' ? 0.22 : 0.35,
                lineBlur: 2.2,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <MapLibreGL.LineLayer
              id="track-route-line"
              style={{
                lineColor: trackingRoute?.source === 'fallback' ? (isDark ? '#94a3b8' : '#8b7d6b') : (isDark ? '#f3d7a7' : '#d5b069'),
                lineWidth: trackingRoute?.source === 'fallback' ? 4 : 6,
                lineOpacity: trackingRoute?.source === 'fallback' ? 0.68 : 0.94,
                lineDasharray: trackingRoute?.source === 'fallback' ? [2, 3] : undefined,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource> : null}

          {liveClientLocation ? <MapLibreGL.PointAnnotation
            id="tracking-client"
            coordinate={[liveClientLocation.longitude, liveClientLocation.latitude]}
          >
            <View style={styles.clientPinWrap}>
              <Animated.View
                style={[
                  styles.clientPinPulse,
                  {
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 2.2] }) }],
                  },
                ]}
              />
              <View style={styles.clientPinDot} />
            </View>
          </MapLibreGL.PointAnnotation> : null}

          {livePhotographerLocation ? <MapLibreGL.PointAnnotation
            id="tracking-provider"
            coordinate={[livePhotographerLocation.longitude, livePhotographerLocation.latitude]}
          >
            <View style={[styles.providerPin, { borderColor: '#f5e3be' }]}>
              {provider?.avatar_url ? (
                <Animated.Image source={{ uri: provider.avatar_url }} style={styles.providerAvatar} />
              ) : (
                <Ionicons name="person" size={22} color="#0f172a" />
              )}
            </View>
          </MapLibreGL.PointAnnotation> : null}
        </MapLibreGL.MapView>
      ) : (
        <View style={[styles.webFallback, { backgroundColor: isDark ? '#0d1628' : '#eef2f7' }]}>
          <Ionicons name="map-outline" size={28} color={isDark ? '#a5b4cf' : '#56627a'} />
          <Text style={[styles.webFallbackTitle, { color: colors.text }]}>{unavailableReason ?? 'Live GPS locations'}</Text>
          {liveClientLocation ? <Text style={[styles.webFallbackText, { color: colors.textSecondary }]}>
            Client: {liveClientLocation.latitude.toFixed(4)}, {liveClientLocation.longitude.toFixed(4)}
          </Text> : null}
          {livePhotographerLocation ? <Text style={[styles.webFallbackText, { color: colors.textSecondary }]}>
            Provider: {livePhotographerLocation.latitude.toFixed(4)}, {livePhotographerLocation.longitude.toFixed(4)}
          </Text> : null}
        </View>
      )}

      <View style={[styles.bottomPanelWrap, { paddingBottom: Math.max(insets.bottom + 6, 18) }]}>
        <View style={[styles.bottomPanel, { backgroundColor: isDark ? 'rgba(12, 20, 38, 0.94)' : 'rgba(255, 250, 241, 0.96)', borderColor: isDark ? '#2a3755' : '#e8dbc4' }]}>
          <View style={[styles.avatarFloat, { backgroundColor: isDark ? '#101c34' : '#fff5e6', borderColor: isDark ? '#f0dbb7' : '#e7cb93' }]}>
            {provider?.avatar_url ? (
              <Animated.Image source={{ uri: provider.avatar_url }} style={styles.avatarFloatImage} />
            ) : (
              <Ionicons name="person" size={22} color={colors.text} />
            )}
          </View>

          <Text style={[styles.timerText, { color: colors.text }]}>{activeTimer === null ? 'ETA unavailable' : formatTimer(activeTimer)}</Text>
          <Text style={[styles.timerSub, { color: colors.textMuted }]}>
            {statusLabel} | {routeSourceLabel}{distanceKm !== null ? ` | ${distanceKm.toFixed(1)} km` : ''}
          </Text>
          {unavailableReason || sharingError ? <Text accessibilityRole="alert" style={[styles.timerSub, { color: colors.textMuted }]}>{unavailableReason || sharingError}</Text> : null}

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                {
                  backgroundColor: isDark ? '#1a2948' : '#f8f1e4',
                  borderColor: isDark ? '#32466d' : '#e3d2b4',
                },
              ]}
              onPress={openChatThread}
            >
              <Ionicons name="chatbubble-outline" size={17} color={colors.textSecondary} />
              <Text style={[styles.actionBtnText, { color: colors.textSecondary }]}>Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                {
                  backgroundColor: isDark ? '#1a2038' : '#f9f2e6',
                  borderColor: isDark ? '#3a4667' : '#e4d4b7',
                },
              ]}
              onPress={cancelBooking}
              disabled={!isCancellable}
            >
              <Ionicons name="close-circle-outline" size={17} color={isCancellable ? '#d97706' : colors.textMuted} />
              <Text style={[styles.actionBtnText, { color: isCancellable ? '#d97706' : colors.textMuted }]}>
                {isCancellable ? 'Cancel' : 'Locked'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  muted: {
    fontSize: 14,
    fontWeight: '600',
  },
  webFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: 220,
    gap: 8,
  },
  webFallbackTitle: {
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  webFallbackText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  clientPinWrap: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientPinPulse: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3b82f6',
  },
  clientPinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  providerPin: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#f0c978',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  providerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  bottomPanelWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 0,
  },
  bottomPanel: {
    borderRadius: 28,
    borderWidth: 1,
    paddingTop: 44,
    paddingHorizontal: 20,
    paddingBottom: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  avatarFloat: {
    position: 'absolute',
    top: -28,
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarFloatImage: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  timerText: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  timerSub: {
    marginTop: 4,
    marginBottom: 14,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  actionRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 13,
    gap: 8,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
});

export default BookingTrackingScreen;
