import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, Easing, Platform, StyleSheet, Text,
  TextInput, TouchableOpacity, View, PanResponder, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { MapLibreGL } from '../components/MapLibreWrapper';
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
import { routingService } from '../services/routingService';
import * as Haptics from 'expo-haptics';
import { Analytics } from '../utils/analytics';
import { getHeatmap } from '../services/dispatchService';

// 🗺 Carto Open Basemaps — 100% free, no API key, no account. OpenStreetMap data.
// Positron: Light grey (Uber daytime aesthetic)
// Dark Matter: Dark grey (Uber nighttime aesthetic)
const MAP_STYLES = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
// Bottom sheet snap points (from bottom of screen)
const SHEET_COLLAPSED = 100;
const SHEET_HALF = SCREEN_HEIGHT * 0.38;
const SHEET_FULL = SCREEN_HEIGHT * 0.82;

const SA_BOUNDS = { minLat: -35, maxLat: -22, minLng: 16, maxLng: 33 };
const isWithinSA = (lat: number, lng: number) =>
  lat >= SA_BOUNDS.minLat && lat <= SA_BOUNDS.maxLat &&
  lng >= SA_BOUNDS.minLng && lng <= SA_BOUNDS.maxLng;

const formatAccuracy = (a?: number | null) => {
  if (!a) return 'Approximate';
  if (a > 250) return `Weak GPS (~${Math.round(a)}m)`;
  if (a > 75) return `~${Math.round(a)}m accurate`;
  return 'High accuracy';
};

const MapScreen: React.FC = () => {
  const { state } = useAppData();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Root'>>();
  const currentUser = state.currentUser;

  const [userMarker, setUserMarker] = useState<MapMarker | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; timestamp: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationWarning, setLocationWarning, ] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapStyle, setMapStyle] = useState<keyof typeof MAP_STYLES>(isDark ? 'dark' : 'light');
  const [onlineProfiles, setOnlineProfiles] = useState<Set<string>>(new Set());

  // Use selected style, or force dark if in dark mode, light (Uber-grey) in light mode
  const MAP_STYLE_URL = MAP_STYLES[mapStyle] ?? MAP_STYLES.light;
  const lastRequestRef = useRef<number>(0);
  const cameraRef = useRef<any>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const [routeProgress, setRouteProgress] = useState(0);
  const [primaryRoute, setPrimaryRoute] = useState<Array<{ lat: number; lng: number }>>([]);
  const [altRoute, setAltRoute] = useState<Array<{ lat: number; lng: number }>>([]);
  const [routeDurationSec, setRouteDurationSec] = useState<number | null>(null);
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [heatmapSummary, setHeatmapSummary] = useState<{ demand: number; supply: number } | null>(null);

  // ── Bottom sheet gesture ─────────────────────────────────────────────────
  const sheetY = useRef(new Animated.Value(SCREEN_HEIGHT - SHEET_COLLAPSED)).current;
  const currentSheetY = useRef(SCREEN_HEIGHT - SHEET_COLLAPSED);

  const snapTo = useCallback((targetY: number, velocity = 0) => {
    currentSheetY.current = targetY;
    Animated.spring(sheetY, {
      toValue: targetY,
      velocity,
      tension: 68,
      friction: 12,
      useNativeDriver: true,
    }).start();
  }, [sheetY]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
    onPanResponderGrant: () => {
      sheetY.stopAnimation();
    },
    onPanResponderMove: (_, g) => {
      const newY = currentSheetY.current + g.dy;
      const clamped = Math.max(SCREEN_HEIGHT - SHEET_FULL, Math.min(SCREEN_HEIGHT - SHEET_COLLAPSED, newY));
      sheetY.setValue(clamped);
    },
    onPanResponderRelease: (_, g) => {
      const y = currentSheetY.current + g.dy;
      const vy = g.vy;
      // Snap to nearest
      if (vy < -0.5 || y < SCREEN_HEIGHT - SHEET_HALF - 50) {
        snapTo(SCREEN_HEIGHT - SHEET_FULL, vy);
      } else if (vy > 0.5 || y > SCREEN_HEIGHT - SHEET_HALF + 50) {
        snapTo(SCREEN_HEIGHT - SHEET_COLLAPSED, vy);
      } else {
        snapTo(SCREEN_HEIGHT - SHEET_HALF, vy);
      }
    },
  }), [snapTo, sheetY]);

  // ── Real-time online presence sync ───────────────────────────────────────
  useEffect(() => {
    if (!currentUser?.id) return;
    // Initial load of online profiles
    const loadOnline = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('is_online', true);
      if (data) setOnlineProfiles(new Set(data.map((r: any) => r.id)));
    };
    loadOnline();

    // Subscribe to realtime changes on profiles.is_online
    const channel = supabase
      .channel('online-presence')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: 'is_online=eq.true',
      }, (payload) => {
        const profile = payload.new as any;
        setOnlineProfiles(prev => {
          const next = new Set(prev);
          if (profile.is_online) next.add(profile.id);
          else next.delete(profile.id);
          return next;
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser?.id]);

  // Pulse animation for user pin
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Active booking detection
  const activeBooking = useMemo(() =>
    state.bookings.find(b =>
      (b.status === 'accepted' || b.status === 'in_progress') &&
      (b.client_id === currentUser?.id || b.photographer_id === currentUser?.id || b.model_id === currentUser?.id)
    ), [state.bookings, currentUser]);

  const activeTalent = useMemo(() => {
    if (!activeBooking) return null;
    const id = activeBooking.photographer_id || activeBooking.model_id;
    return state.photographers.find(p => p.id === id) || state.models.find(m => m.id === id);
  }, [activeBooking, state.photographers, state.models]);

  // Build map markers
  const baseMarkers: MapMarker[] = useMemo(() => {
    const role = currentUser?.role || 'client';
    let result: MapMarker[] = [];
    if (role === 'photographer') {
      result = state.models.map(m => ({ id: `model-${m.id}`, sourceId: m.id, title: m.name, description: 'Model', latitude: m.latitude, longitude: m.longitude, type: 'model' as const, avatarUrl: m.avatar_url }));
    } else if (role === 'model') {
      result = state.photographers.map(p => ({ id: `photo-${p.id}`, sourceId: p.id, title: p.name, description: 'Photographer', latitude: p.latitude, longitude: p.longitude, type: 'photographer' as const, avatarUrl: p.avatar_url }));
    } else {
      result = [
        ...state.photographers.map(p => ({ id: `photo-${p.id}`, sourceId: p.id, title: p.name, description: 'Photographer', latitude: p.latitude, longitude: p.longitude, type: 'photographer' as const, avatarUrl: p.avatar_url })),
        ...state.models.map(m => ({ id: `model-${m.id}`, sourceId: m.id, title: m.name, description: 'Model', latitude: m.latitude, longitude: m.longitude, type: 'model' as const, avatarUrl: m.avatar_url })),
      ];
    }
    const seen = new Set<string>();
    return result.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
  }, [state.photographers, state.models, currentUser]);

  const filteredMarkers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return baseMarkers;
    return baseMarkers.filter(m => (m.title ?? '').toLowerCase().includes(q) || (m.description ?? '').toLowerCase().includes(q));
  }, [baseMarkers, searchQuery]);

  const markers = useMemo(() => userMarker ? [userMarker, ...filteredMarkers] : filteredMarkers, [filteredMarkers, userMarker]);

  // GeoJSON for clustering (MapLibre handles cluster rendering natively)
  const markersGeoJson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: filteredMarkers.map(m => ({
      type: 'Feature' as const,
      id: m.id,
      properties: {
        id: m.id,
        sourceId: m.sourceId,
        title: m.title,
        type: m.type,
        isOnline: onlineProfiles.has(m.sourceId ?? ''),
      },
      geometry: { type: 'Point' as const, coordinates: [m.longitude, m.latitude] },
    })),
  }), [filteredMarkers, onlineProfiles]);

  const mapCenter = useMemo(() => {
    if (userCoords) return [userCoords.lng, userCoords.lat];
    if (filteredMarkers[0]) return [filteredMarkers[0].longitude, filteredMarkers[0].latitude];
    return [18.4241, -33.9249]; // Cape Town default
  }, [filteredMarkers, userCoords]);

  const requestLocation = useCallback(async () => {
    const now = Date.now();
    if (now - lastRequestRef.current < 750) return;
    lastRequestRef.current = now;
    setRequesting(true);
    setLocationError(null);
    setLocationWarning(null);
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) { setLocationError('Location services disabled. Enable GPS to find nearby talent.'); return; }
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError(canAskAgain ? 'Location permission needed.' : 'Enable location in device settings.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const { latitude, longitude, accuracy } = pos.coords;
      if (!isWithinSA(latitude, longitude)) {
        setLocationError('Currently supporting South African locations only.');
        return;
      }
      if (accuracy && accuracy > 120) setLocationWarning('Weak GPS signal — location is approximate.');
      setUserMarker({ id: `user-${currentUser?.id ?? 'loc'}`, title: 'You', description: formatAccuracy(accuracy), latitude, longitude, type: 'user' });
      setUserCoords({ lat: latitude, lng: longitude, timestamp: pos.timestamp });
      cameraRef.current?.setCamera({ centerCoordinate: [longitude, latitude], zoomLevel: 13, animationMode: 'flyTo', animationDuration: 900 });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Analytics.mapOpened();
    } catch { setLocationError('Unable to get GPS. Try entering location manually.'); }
    finally { setRequesting(false); }
  }, [currentUser]);

  // Route fetching
  const fetchRoutes = useCallback(async () => {
    if (!selectedMarker || !userCoords) return;
    try {
      const start = { latitude: userCoords.lat, longitude: userCoords.lng };
      const end = { latitude: selectedMarker.latitude, longitude: selectedMarker.longitude };
      const route = await routingService.getRoute(start, end);
      setPrimaryRoute(route.coordinates.map(([lng, lat]) => ({ lat, lng })));
      setAltRoute(route.coordinates.map(([lng, lat], i) => ({
        lat: lat + (i % 3 === 0 ? 0.0002 : -0.0001),
        lng: lng + (i % 3 === 0 ? 0.0002 : -0.0001),
      })));
      setRouteDistanceKm(route.distance);
      setRouteDurationSec(route.duration);
      setRouteProgress(0);
    } catch {
      setRouteDistanceKm(null);
      setRouteDurationSec(null);
    }
  }, [selectedMarker, userCoords]);

  useEffect(() => { fetchRoutes(); }, [fetchRoutes]);

  useEffect(() => {
    let active = true;
    const hydrateHeatmap = async () => {
      try {
        const data = await getHeatmap({ role: 'combined', hours: 6, city: currentUser?.city || 'Cape Town' });
        if (!active) return;
        const demand = (data.buckets ?? []).reduce((acc, b) => acc + Number(b.demand_count || 0), 0);
        const supply = (data.buckets ?? []).reduce((acc, b) => acc + Number(b.online_count || 0), 0);
        setHeatmapSummary({ demand, supply });
      } catch {
        if (!active) return;
        setHeatmapSummary(null);
      }
    };
    hydrateHeatmap();
    return () => { active = false; };
  }, [currentUser?.city]);

  // Route draw animation
  useEffect(() => {
    if (primaryRoute.length < 2) { setRouteProgress(0); return; }
    let raf: number | null = null;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(1, elapsed / 1200);
      setRouteProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [primaryRoute.length]);

  const sliceRoute = (coords: Array<{ lat: number; lng: number }>, p: number) =>
    coords.slice(0, Math.max(2, Math.floor(coords.length * p)));

  const primarySlice = useMemo(() => sliceRoute(primaryRoute, routeProgress), [primaryRoute, routeProgress]);
  const altSlice = useMemo(() => sliceRoute(altRoute, routeProgress), [altRoute, routeProgress]);

  const toGeoJson = (slice: Array<{ lat: number; lng: number }>) => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: slice.map(p => [p.lng, p.lat]) }, properties: {},
  });

  const selectedDistance = useMemo(() => {
    if (!selectedMarker || !userCoords) return null;
    if (routeDistanceKm && routeDistanceKm > 0) return `${routeDistanceKm.toFixed(1)} km`;
    const km = haversineDistanceKm({ latitude: userCoords.lat, longitude: userCoords.lng }, { latitude: selectedMarker.latitude, longitude: selectedMarker.longitude });
    return `${km.toFixed(1)} km`;
  }, [selectedMarker, userCoords, routeDistanceKm]);

  const etaLabel = useMemo(() => {
    if (routeDurationSec && routeDurationSec > 0) return `${Math.max(3, Math.round(routeDurationSec / 60))} min`;
    if (!selectedDistance) return null;
    const km = parseFloat(selectedDistance);
    return isNaN(km) ? null : `${Math.max(6, Math.round(km * 3.4))} min`;
  }, [selectedDistance, routeDurationSec]);

  const handleRequestBooking = async (marker: MapMarker) => {
    if (!userCoords) { Alert.alert('Location required', 'Enable GPS first.'); return; }
    setIsRequesting(true);
    try {
      const pkg = BOOKING_PACKAGES.find(p => p.id === 'instant') ?? BOOKING_PACKAGES[0];
      const base = pkg.basePrice;
      const commission = Math.round(base * 0.3);
      const payout = base - commission;
      const providerId = marker.sourceId ?? marker.id;
      const isModel = marker.type === 'model';
      const { error } = await supabase.from('bookings').insert({
        client_id: currentUser?.id,
        photographer_id: isModel ? null : providerId,
        model_id: isModel ? providerId : null,
        status: 'pending',
        package_type: `${pkg.label} (${marker.type})`,
        user_latitude: userCoords.lat,
        user_longitude: userCoords.lng,
        booking_date: new Date().toISOString(),
        price_total: base,
        photographer_payout: payout,
        commission_amount: commission,
        is_instant: true,
      });
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('✅ Request Sent', `Waiting for ${marker.title} to accept...`);
      Analytics.bookingCreated(pkg.label, base);
      snapTo(SCREEN_HEIGHT - SHEET_COLLAPSED);
      setSelectedMarker(null);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsRequesting(false);
    }
  };

  const cycleMapStyle = () => {
    const styles: Array<keyof typeof MAP_STYLES> = ['light', 'dark'];
    const idx = styles.indexOf(mapStyle);
    setMapStyle(styles[(idx + 1) % styles.length]);
  };

  if (Platform.OS === 'web') {
    return (
      <View style={[s.container, { backgroundColor: colors.bg }]}>
        <MapPreview markers={markers} onMapError={() => {}} />
      </View>
    );
  }

  return (
    <View style={s.container}>
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
          animationDuration={700}
        />

        {/* Alt route (dashed, muted Uber-like fallback) */}
        {altSlice.length > 1 && (
          <MapLibreGL.ShapeSource id="route-alt" shape={toGeoJson(altSlice) as any}>
            <MapLibreGL.LineLayer id="route-alt-line" style={{ lineColor: isDark ? '#6b7280' : '#9ca3af', lineOpacity: 0.45, lineWidth: 4, lineDasharray: [2, 3] }} />
          </MapLibreGL.ShapeSource>
        )}

        {/* Primary route */}
        {primarySlice.length > 1 && (
          <MapLibreGL.ShapeSource id="route-primary" shape={toGeoJson(primarySlice) as any}>
            <MapLibreGL.LineLayer id="route-primary-line" style={{ lineColor: isDark ? '#f3f4f6' : '#111827', lineOpacity: 0.96, lineWidth: 6, lineCap: 'round', lineJoin: 'round' }} />
          </MapLibreGL.ShapeSource>
        )}

        {/* Clustered talent markers using GeoJSON ShapeSource */}
        <MapLibreGL.ShapeSource
          id="talent-cluster"
          shape={markersGeoJson}
          cluster
          clusterMaxZoomLevel={14}
          clusterRadius={50}
          onPress={(e) => {
            const feature = e.features?.[0];
            if (!feature) return;
            if (feature.properties?.cluster) {
              // Zoom into cluster
              cameraRef.current?.setCamera({
                centerCoordinate: (feature.geometry as any).coordinates,
                zoomLevel: 13,
                animationMode: 'flyTo',
                animationDuration: 500,
              });
            } else {
              const {id, sourceId, title, description, type} = feature.properties ?? {};
              const coord = (feature.geometry as any).coordinates;
              setSelectedMarker({ id, sourceId, title, description, latitude: coord[1], longitude: coord[0], type });
              snapTo(SCREEN_HEIGHT - SHEET_HALF);
            }
          }}
        >
          {/* Cluster circle */}
          <MapLibreGL.CircleLayer
            id="clusters"
            belowLayerID="cluster-count"
            filter={['has', 'point_count']}
            style={{
              circleColor: ['step', ['get', 'point_count'], '#374151', 10, '#1f2937', 30, '#111827'],
              circleRadius: ['step', ['get', 'point_count'], 20, 10, 28, 30, 36],
              circleStrokeWidth: 3,
              circleStrokeColor: isDark ? '#0f172a' : '#f9fafb',
              circleOpacity: 0.92,
            }}
          />
          {/* Cluster count label */}
          <MapLibreGL.SymbolLayer
            id="cluster-count"
            filter={['has', 'point_count']}
            style={{
              textField: ['get', 'point_count_abbreviated'],
              textFont: ['Open Sans Bold', 'Arial Unicode MS Bold'],
              textSize: 13,
              textColor: '#ffffff',
            }}
          />
          {/* Individual talent pins */}
          <MapLibreGL.CircleLayer
            id="unclustered-point"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleColor: ['case',
                ['get', 'isOnline'], ['case', ['==', ['get', 'type'], 'model'], '#059669', '#10b981'],
                ['case', ['==', ['get', 'type'], 'model'], '#9ca3af', '#6b7280'],
              ],
              circleRadius: 14,
              circleStrokeWidth: ['case', ['get', 'isOnline'], 3, 2],
              circleStrokeColor: ['case', ['get', 'isOnline'], '#ffffff', '#d1d5db'],
              circleOpacity: 0.95,
            }}
          />
        </MapLibreGL.ShapeSource>

        {/* User location pin */}
        {userMarker && (
          <MapLibreGL.PointAnnotation id={userMarker.id} key={userMarker.id} coordinate={[userMarker.longitude, userMarker.latitude]}>
            <View style={s.userPinWrapper}>
              <Animated.View style={[s.userPulse, {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.0] }) }],
              }]} />
              <View style={s.userPinCore} />
              <View style={s.userPinRing} />
            </View>
          </MapLibreGL.PointAnnotation>
        )}
      </MapLibreGL.MapView>

      {/* Map style + locate controls (top-right floating buttons Uber-style) */}
      <SafeAreaView style={[s.safeOverlay, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={[s.topBar, { backgroundColor: isDark ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.95)' }]}>
          <View style={s.searchBox}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              placeholder="Search photographers or models..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={[s.searchInput, { color: colors.text }]}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Live status pill */}
        {userCoords && (
          <View style={[s.statusPill, { backgroundColor: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.9)' }]}>
            <View style={s.liveDot} />
            <Text style={[s.liveText, { color: colors.text }]}>
              Live · {filteredMarkers.filter(m => onlineProfiles.has(m.sourceId ?? '')).length} online nearby
            </Text>
          </View>
        )}
        {heatmapSummary && (
          <View style={[s.statusPill, { marginTop: 8, backgroundColor: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.9)' }]}>
            <Ionicons name="flame-outline" size={13} color={isDark ? '#fbbf24' : '#b45309'} />
            <Text style={[s.liveText, { color: colors.text }]}>
              Demand {heatmapSummary.demand} · Supply {heatmapSummary.supply}
            </Text>
          </View>
        )}

        {locationError && (
          <View style={s.errorBanner}>
            <Ionicons name="warning" size={14} color="#fbbf24" />
            <Text style={s.errorBannerText}>{locationError}</Text>
          </View>
        )}
      </SafeAreaView>

      {/* Floating action buttons (right side, Uber-style) */}
      <View style={[s.fabColumn, { bottom: SHEET_COLLAPSED + insets.bottom + 20 }]}>
        <TouchableOpacity style={[s.fab, { backgroundColor: isDark ? '#1e293b' : '#fff' }]} onPress={requestLocation} disabled={requesting}>
          <Ionicons name={requesting ? 'hourglass' : 'locate'} size={22} color={colors.accent} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.fab, { backgroundColor: isDark ? '#1e293b' : '#fff' }]} onPress={cycleMapStyle}>
          <Ionicons name="layers" size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.fab, { backgroundColor: isDark ? '#1e293b' : '#fff' }]} onPress={() => navigation.navigate('Notifications')}>
          <Ionicons name="notifications-outline" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Gesture-driven bottom sheet (better than Uber's) */}
      <Animated.View
        style={[s.bottomSheet, { backgroundColor: isDark ? '#0f172a' : '#fff', transform: [{ translateY: sheetY }] }]}
        {...panResponder.panHandlers}
      >
        {/* Drag handle */}
        <View style={s.dragHandle} />

        <View style={[s.sheetInner, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {activeBooking ? (
            /* ACTIVE BOOKING VIEW */
            <>
              <View style={s.sheetHeader}>
                <View style={[s.sheetAvatar, { backgroundColor: '#10b98120' }]}>
                  <Ionicons name="car" size={24} color="#10b981" />
                </View>
                <View style={s.sheetInfo}>
                  <Text style={[s.sheetTitle, { color: colors.text }]}>
                    {activeBooking.status === 'accepted' ? '🚗 En Route to You' : '📸 Shoot in Progress'}
                  </Text>
                  <Text style={[s.sheetSub, { color: colors.textSecondary }]}>
                    {activeTalent?.name ?? 'Talent'} · ETA {etaLabel ?? '~15 min'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => navigation.navigate('BookingTracking', { bookingId: activeBooking.id })} style={s.trackBtn}>
                  <Ionicons name="navigate" size={20} color="#2563eb" />
                </TouchableOpacity>
              </View>
              <View style={s.metricsRow}>
                {[
                  { label: 'Distance', value: selectedDistance ?? '—' },
                  { label: 'ETA', value: etaLabel ?? '—' },
                  { label: 'Status', value: activeBooking.status, color: '#10b981' },
                ].map(m => (
                  <View key={m.label} style={s.metricItem}>
                    <Text style={[s.metricLabel, { color: colors.textMuted }]}>{m.label}</Text>
                    <Text style={[s.metricValue, { color: m.color ?? colors.text }]}>{m.value}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={[s.primaryBtn, { backgroundColor: colors.accent }]}
                onPress={() => navigation.navigate('ChatThread', { conversationId: `chat-${activeBooking.id}`, title: activeTalent?.name })}
              >
                <Ionicons name="chatbubble" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={s.primaryBtnText}>Message {activeTalent?.name?.split(' ')[0] ?? 'Talent'}</Text>
              </TouchableOpacity>
            </>
          ) : selectedMarker ? (
            /* SELECTED TALENT VIEW */
            <>
              <View style={s.sheetHeader}>
                <View style={[s.sheetAvatar, { backgroundColor: selectedMarker.type === 'model' ? '#ec489920' : '#3b82f620' }]}>
                  <Ionicons name={selectedMarker.type === 'model' ? 'sparkles' : 'camera'} size={22} color={selectedMarker.type === 'model' ? '#ec4899' : '#3b82f6'} />
                </View>
                <View style={s.sheetInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[s.sheetTitle, { color: colors.text }]}>{selectedMarker.title}</Text>
                    {onlineProfiles.has(selectedMarker.sourceId ?? '') && (
                      <View style={s.onlineBadge}><Text style={s.onlineBadgeText}>LIVE</Text></View>
                    )}
                  </View>
                  <Text style={[s.sheetSub, { color: colors.textSecondary }]}>{selectedMarker.description}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedMarker(null)}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={s.metricsRow}>
                {[
                  { label: 'Distance', value: selectedDistance ?? '—' },
                  { label: 'ETA', value: etaLabel ?? '—' },
                  { label: 'Status', value: onlineProfiles.has(selectedMarker.sourceId ?? '') ? 'Available' : 'Offline', color: onlineProfiles.has(selectedMarker.sourceId ?? '') ? '#10b981' : '#64748b' },
                ].map(m => (
                  <View key={m.label} style={s.metricItem}>
                    <Text style={[s.metricLabel, { color: colors.textMuted }]}>{m.label}</Text>
                    <Text style={[s.metricValue, { color: m.color ?? colors.text }]}>{m.value}</Text>
                  </View>
                ))}
              </View>

              <View style={s.sheetActions}>
                <TouchableOpacity
                  style={[s.ghostBtn, { borderColor: colors.border, flex: 1 }]}
                  onPress={() => navigation.navigate('UserProfile', { userId: selectedMarker.sourceId ?? '' })}
                >
                  <Ionicons name="person-circle-outline" size={18} color={colors.text} />
                  <Text style={[s.ghostBtnText, { color: colors.text }]}>Profile</Text>
                </TouchableOpacity>
                {currentUser?.role === 'client' && (
                  <TouchableOpacity
                    style={[s.primaryBtn, { flex: 2 }]}
                    onPress={() => handleRequestBooking(selectedMarker)}
                    disabled={isRequesting}
                  >
                    <Ionicons name="flash" size={18} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={s.primaryBtnText}>{isRequesting ? 'Requesting...' : 'Instant Book'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          ) : (
            /* DEFAULT VIEW */
            <>
              <Text style={[s.sheetTitle, { color: colors.text }]}>
                {filteredMarkers.length} Talents Nearby
              </Text>
              <Text style={[s.sheetSub, { color: colors.textSecondary }]}>
                {onlineProfiles.size} available now · Tap a pin to book instantly
              </Text>
              <TouchableOpacity style={[s.primaryBtn, { marginTop: 12 }]} onPress={requestLocation} disabled={requesting}>
                <Ionicons name="navigate" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={s.primaryBtnText}>{requesting ? 'Finding location...' : 'Find Talent Near Me'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Animated.View>
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  safeOverlay: { position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'box-none' },
  topBar: { marginHorizontal: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 4 },
  statusPill: { marginTop: 10, marginHorizontal: 16, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, elevation: 3 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10b981' },
  liveText: { fontSize: 13, fontWeight: '700' },
  errorBanner: { marginTop: 8, marginHorizontal: 16, flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(253,224,71,0.1)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)' },
  errorBannerText: { color: '#fbbf24', fontSize: 12, fontWeight: '600', flex: 1 },
  fabColumn: { position: 'absolute', right: 16, gap: 10 },
  fab: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  userPinWrapper: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  userPulse: { position: 'absolute', width: 32, height: 32, borderRadius: 16, backgroundColor: '#3b82f6' },
  userPinCore: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#2563eb', borderWidth: 3, borderColor: '#fff' },
  userPinRing: { position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#3b82f6' },
  bottomSheet: { position: 'absolute', left: 0, right: 0, height: SCREEN_HEIGHT, borderTopLeftRadius: 28, borderTopRightRadius: 28, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: -8 }, elevation: 16 },
  dragHandle: { width: 48, height: 5, borderRadius: 4, backgroundColor: '#94a3b8', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  sheetInner: { paddingHorizontal: 20, paddingTop: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  sheetAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  sheetInfo: { flex: 1 },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  sheetSub: { fontSize: 14, marginTop: 2 },
  onlineBadge: { backgroundColor: '#10b981', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  onlineBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  metricsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  metricItem: { flex: 1, backgroundColor: '#1e293b', borderRadius: 14, padding: 14, alignItems: 'center' },
  metricLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  metricValue: { fontSize: 17, fontWeight: '800' },
  sheetActions: { flexDirection: 'row', gap: 12 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#2563eb', borderRadius: 16, paddingVertical: 16, shadowColor: '#2563eb', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 16, paddingVertical: 14, gap: 6 },
  ghostBtnText: { fontWeight: '700', fontSize: 14 },
  trackBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#2563eb20', alignItems: 'center', justifyContent: 'center' },
});

export default MapScreen;
