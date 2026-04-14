import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { Booking, Photographer } from '../types';
import { useAppData } from '../store/AppDataContext';
import { DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates, haversineDistanceKm } from '../utils/geo';
import { hasSupabase, supabase } from '../config/supabaseClient';
import { getDispatchState, getEta } from '../services/dispatchService';
import { MapLibreGL, isMapLibreNativeAvailable } from '../components/MapLibreWrapper';
import { useTheme } from '../store/ThemeContext';
import { getEffectiveRole, isPhotographerUser } from '../utils/userRole';

type Route = RouteProp<RootStackParamList, 'BookingTracking'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingTracking'>;

const MAP_STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const toStatusLabel = (status: Booking['status']) => {
  if (status === 'accepted') return 'En Route';
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
  const photographer = useMemo(
    () => state.photographers.find((p) => p.id === booking?.photographer_id),
    [booking?.photographer_id, state.photographers]
  );

  const [liveClientLocation, setLiveClientLocation] = useState(() =>
    ensureSouthAfricanCoordinates({
      latitude: booking?.user_latitude ?? photographer?.latitude ?? DEFAULT_CAPE_TOWN_COORDINATES.latitude,
      longitude: booking?.user_longitude ?? photographer?.longitude ?? DEFAULT_CAPE_TOWN_COORDINATES.longitude,
    })
  );
  const [livePhotographerLocation, setLivePhotographerLocation] = useState(() =>
    ensureSouthAfricanCoordinates({
      latitude: photographer?.latitude ?? DEFAULT_CAPE_TOWN_COORDINATES.latitude - 0.1,
      longitude: photographer?.longitude ?? DEFAULT_CAPE_TOWN_COORDINATES.longitude - 0.1,
    })
  );
  const [assignmentState, setAssignmentState] = useState<string>(booking?.assignment_state || 'queued');
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [etaConfidence, setEtaConfidence] = useState<number>(booking?.eta_confidence ?? 0.6);
  const [countdownSec, setCountdownSec] = useState(0);

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
    if (!booking) return;
    setLiveClientLocation(
      ensureSouthAfricanCoordinates({
        latitude: booking.user_latitude ?? DEFAULT_CAPE_TOWN_COORDINATES.latitude,
        longitude: booking.user_longitude ?? DEFAULT_CAPE_TOWN_COORDINATES.longitude,
      })
    );
  }, [booking?.id, booking?.user_latitude, booking?.user_longitude]);

  useEffect(() => {
    if (!photographer) return;
    setLivePhotographerLocation(
      ensureSouthAfricanCoordinates({
        latitude: photographer.latitude,
        longitude: photographer.longitude,
      })
    );
  }, [photographer?.id, photographer?.latitude, photographer?.longitude]);

  useEffect(() => {
    if (!booking || !state.currentUser) return;
    let mounted = true;
    let watcher: Location.LocationSubscription | null = null;

    const startLiveTracking = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted' || !mounted) return;

      watcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 20,
          timeInterval: 7000,
        },
        async ({ coords }) => {
          if (!mounted) return;
          const next = ensureSouthAfricanCoordinates({
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
          try {
            if (getEffectiveRole(state.currentUser) === 'client') {
              setLiveClientLocation(next);
              await updateBookingClientLocation(booking.id, next.latitude, next.longitude, coords.accuracy ?? undefined);
            } else if (isPhotographerUser(state.currentUser)) {
              setLivePhotographerLocation(next);
              await updatePhotographerLocation(next.latitude, next.longitude, booking.id, coords.accuracy ?? undefined);
            }
          } catch {
            // keep UI alive on intermittent sync failures
          }
        }
      );
    };

    startLiveTracking();

    return () => {
      mounted = false;
      watcher?.remove();
    };
  }, [booking, state.currentUser, updateBookingClientLocation, updatePhotographerLocation]);

  useEffect(() => {
    if (!hasSupabase || !booking) return;
    const channel = supabase
      .channel(`booking-tracking-${booking.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${booking.id}` },
        (payload) => {
          const next = payload.new as Partial<Booking>;
          if (next?.user_latitude !== undefined && next?.user_longitude !== undefined) {
            setLiveClientLocation(
              ensureSouthAfricanCoordinates({
                latitude: Number(next.user_latitude),
                longitude: Number(next.user_longitude),
              })
            );
          }
        }
      );

    if (photographer?.id) {
      channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'photographers', filter: `id=eq.${photographer.id}` },
        (payload) => {
          const next = payload.new as Partial<Photographer>;
          if (next?.latitude !== undefined && next?.longitude !== undefined) {
            setLivePhotographerLocation(
              ensureSouthAfricanCoordinates({
                latitude: Number(next.latitude),
                longitude: Number(next.longitude),
              })
            );
          }
        }
      );
    }

    channel.subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [booking, photographer?.id]);

  useEffect(() => {
    if (!booking?.id) return;
    let active = true;

    const hydrateEtaAndDispatch = async () => {
      try {
        if (booking.dispatch_request_id) {
          const dispatch = await getDispatchState(booking.dispatch_request_id);
          if (!active) return;
          setAssignmentState(dispatch.assignment_state || booking.assignment_state || 'queued');
          if (dispatch.eta_confidence != null) setEtaConfidence(Number(dispatch.eta_confidence));
        }
      } catch {
        // non-fatal
      }

      try {
        const eta = await getEta(booking.id);
        if (!active) return;
        if (Number.isFinite(eta.eta_minutes)) {
          const mins = Number(eta.eta_minutes);
          setEtaMinutes(mins);
          setCountdownSec(Math.max(60, Math.round(mins * 60)));
        }
        if (eta.eta_confidence != null) setEtaConfidence(Number(eta.eta_confidence));
      } catch {
        // non-fatal
      }
    };

    hydrateEtaAndDispatch();
    const timer = setInterval(hydrateEtaAndDispatch, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [booking?.id, booking?.dispatch_request_id, booking?.assignment_state, booking?.eta_confidence]);

  useEffect(() => {
    if (countdownSec <= 0) return;
    const timer = setInterval(() => {
      setCountdownSec((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdownSec]);

  const openChatThread = async () => {
    if (!photographer) {
      navigation.navigate('Root', { screen: 'Chat' });
      return;
    }

    try {
      const convo = await startConversationWithUser(photographer.id, photographer.name);
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

  const centerLat = (liveClientLocation.latitude + livePhotographerLocation.latitude) / 2;
  const centerLng = (liveClientLocation.longitude + livePhotographerLocation.longitude) / 2;
  const routeGeoJson = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [livePhotographerLocation.longitude, livePhotographerLocation.latitude],
        [liveClientLocation.longitude, liveClientLocation.latitude],
      ],
    },
    properties: {},
  };

  const distanceKm = haversineDistanceKm(livePhotographerLocation, liveClientLocation);
  const fallbackMins = Math.max(3, Math.round((distanceKm / 35) * 60));
  const activeTimer = countdownSec > 0 ? countdownSec : Math.max(60, (etaMinutes ?? fallbackMins) * 60);
  const isCancellable = booking.status === 'pending' || booking.status === 'accepted' || booking.status === 'in_progress';
  const statusLabel = toStatusLabel(booking.status);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {isMapLibreNativeAvailable ? (
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

          <MapLibreGL.ShapeSource id="track-route" shape={routeGeoJson as any}>
            <MapLibreGL.LineLayer
              id="track-route-glow"
              style={{
                lineColor: isDark ? '#f7d7a2' : '#e5c28b',
                lineWidth: 12,
                lineOpacity: 0.35,
                lineBlur: 2.2,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <MapLibreGL.LineLayer
              id="track-route-line"
              style={{
                lineColor: isDark ? '#f3d7a7' : '#d5b069',
                lineWidth: 6,
                lineOpacity: 0.94,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource>

          <MapLibreGL.PointAnnotation
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
          </MapLibreGL.PointAnnotation>

          <MapLibreGL.PointAnnotation
            id="tracking-provider"
            coordinate={[livePhotographerLocation.longitude, livePhotographerLocation.latitude]}
          >
            <View style={[styles.providerPin, { borderColor: '#f5e3be' }]}>
              {photographer?.avatar_url ? (
                <Animated.Image source={{ uri: photographer.avatar_url }} style={styles.providerAvatar} />
              ) : (
                <Ionicons name="person" size={22} color="#0f172a" />
              )}
            </View>
          </MapLibreGL.PointAnnotation>
        </MapLibreGL.MapView>
      ) : (
        <View style={[styles.webFallback, { backgroundColor: isDark ? '#0d1628' : '#eef2f7' }]}>
          <Ionicons name="map-outline" size={28} color={isDark ? '#a5b4cf' : '#56627a'} />
          <Text style={[styles.webFallbackTitle, { color: colors.text }]}>Live tracking map is available on iOS and Android builds</Text>
          <Text style={[styles.webFallbackText, { color: colors.textSecondary }]}>
            Client: {liveClientLocation.latitude.toFixed(4)}, {liveClientLocation.longitude.toFixed(4)}
          </Text>
          <Text style={[styles.webFallbackText, { color: colors.textSecondary }]}>
            Provider: {livePhotographerLocation.latitude.toFixed(4)}, {livePhotographerLocation.longitude.toFixed(4)}
          </Text>
        </View>
      )}

      <View style={[styles.bottomPanelWrap, { paddingBottom: Math.max(insets.bottom + 6, 18) }]}>
        <View style={[styles.bottomPanel, { backgroundColor: isDark ? 'rgba(12, 20, 38, 0.94)' : 'rgba(255, 250, 241, 0.96)', borderColor: isDark ? '#2a3755' : '#e8dbc4' }]}>
          <View style={[styles.avatarFloat, { backgroundColor: isDark ? '#101c34' : '#fff5e6', borderColor: isDark ? '#f0dbb7' : '#e7cb93' }]}>
            {photographer?.avatar_url ? (
              <Animated.Image source={{ uri: photographer.avatar_url }} style={styles.avatarFloatImage} />
            ) : (
              <Ionicons name="person" size={22} color={colors.text} />
            )}
          </View>

          <Text style={[styles.timerText, { color: colors.text }]}>{formatTimer(activeTimer)}</Text>
          <Text style={[styles.timerSub, { color: colors.textMuted }]}>
            {statusLabel} • {assignmentState.replace('_', ' ')} • {distanceKm.toFixed(1)} km away • Confidence {(etaConfidence * 100).toFixed(0)}%
          </Text>

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
