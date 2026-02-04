import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { MapPreview } from '../components/MapPreview';
import { MapMarker } from '../components/mapTypes';
import { useAppData } from '../store/AppDataContext';

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
  } catch (err) {
    console.warn('Failed to format timestamp', err);
    return 'recently';
  }
};

const MapScreen: React.FC = () => {
  const { state } = useAppData();
  const [userMarker, setUserMarker] = useState<MapMarker | null>(null);
  const [userCoordinates, setUserCoordinates] = useState<UserCoordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [usingManual, setUsingManual] = useState(false);
  const [manualLocation, setManualLocation] = useState({ label: '', latitude: '', longitude: '' });
  const [gpsEnabled, setGpsEnabled] = useState<boolean | null>(null);
  const lastRequestRef = useRef<number>(0);

  const baseMarkers: MapMarker[] = useMemo(
    () =>
      state.photographers.map((photographer) => ({
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
    } catch (err) {
      console.warn('Location request failed', err);
      handleLocationFailure('Unable to fetch GPS. Check connectivity or enter your location manually.');
    } finally {
      setRequesting(false);
    }
  }, [handleLocationFailure]);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Photographers nearby</Text>
            <Text style={styles.subtitle}>
              Native apps render OpenStreetMap tiles with live markers. Web shows a preview list.
            </Text>
            <Text style={styles.status}>{statusLabel}</Text>
            <Text style={styles.coordsLabel}>
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
          <View style={styles.countPill}>
            <Text style={styles.countText}>{baseMarkers.length}</Text>
            <Text style={styles.countLabel}>active</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.primaryButton} onPress={requestLocation} disabled={requesting}>
            <Text style={styles.primaryButtonText}>{requesting ? 'Requesting...' : 'Retry GPS'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, usingManual && styles.secondaryButtonActive]}
            onPress={() => setUsingManual(true)}
          >
            <Text style={[styles.secondaryButtonText, usingManual && styles.secondaryButtonTextActive]}>
              Manual location
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.mapWrapper}>
          <MapPreview markers={markers} onMapError={(message) => setMapError(message)} />
        </View>

        <View style={styles.manualCard}>
          <Text style={styles.manualTitle}>Manual fallback</Text>
          <Text style={styles.manualSubtitle}>
            If GPS or map tiles fail, enter a South Africa coordinate. We only accept lat -35 to -22 and lng 16
            to 33.
          </Text>
          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Label</Text>
              <TextInput
                placeholder="Cape Town CBD"
                value={manualLocation.label}
                onChangeText={(text) => setManualLocation((prev) => ({ ...prev, label: text }))}
                style={styles.input}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Latitude</Text>
              <TextInput
                placeholder="-33.92"
                value={manualLocation.latitude}
                onChangeText={(text) => setManualLocation((prev) => ({ ...prev, latitude: text }))}
                style={styles.input}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Longitude</Text>
              <TextInput
                placeholder="18.42"
                value={manualLocation.longitude}
                onChangeText={(text) => setManualLocation((prev) => ({ ...prev, longitude: text }))}
                style={styles.input}
                keyboardType="numeric"
              />
            </View>
          </View>
          <TouchableOpacity style={styles.applyButton} onPress={applyManualLocation}>
            <Text style={styles.applyButtonText}>Pin manual location</Text>
          </TouchableOpacity>
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
  status: {
    color: '#0f172a',
    fontWeight: '700',
  },
  coordsLabel: {
    marginTop: 4,
    color: '#334155',
    fontFamily: 'monospace',
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
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  secondaryButtonActive: {
    borderColor: '#0ea5e9',
    backgroundColor: '#ecfeff',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  secondaryButtonTextActive: {
    color: '#0ea5e9',
  },
  mapWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  manualCard: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  manualTitle: {
    fontWeight: '800',
    color: '#0f172a',
  },
  manualSubtitle: {
    color: '#475569',
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
    color: '#0f172a',
    marginBottom: 4,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#f8fafc',
  },
  applyButton: {
    marginTop: 10,
    backgroundColor: '#0ea5e9',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
});

export default MapScreen;
