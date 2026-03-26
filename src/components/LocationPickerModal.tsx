import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { MapLibreGL, isMapLibreNativeAvailable } from './MapLibreWrapper';

type LocationResult = {
  coords: { lat: number; lng: number };
  label?: string;
};

type Props = {
  visible: boolean;
  initialCoords?: { lat: number; lng: number };
  initialLabel?: string;
  onClose: () => void;
  onSelect: (result: LocationResult) => void;
};

const LocationPickerModal: React.FC<Props> = ({ visible, initialCoords, initialLabel, onClose, onSelect }) => {
  const { colors, isDark } = useTheme();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(initialCoords ?? null);
  const [label, setLabel] = useState(initialLabel ?? '');
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setCoords(initialCoords ?? null);
    setLabel(initialLabel ?? '');
    setError(null);
    setLatText(initialCoords ? String(initialCoords.lat.toFixed(6)) : '');
    setLngText(initialCoords ? String(initialCoords.lng.toFixed(6)) : '');
  }, [visible, initialCoords, initialLabel]);

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      const item = results?.[0];
      if (!item) return;
      const nextLabel = [item.city, item.region].filter(Boolean).join(', ');
      if (nextLabel) setLabel(nextLabel);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!coords) return;
    setLatText(String(coords.lat.toFixed(6)));
    setLngText(String(coords.lng.toFixed(6)));
  }, [coords?.lat, coords?.lng]);

  const parseCoordinate = (value: string) => {
    const cleaned = value.replace(',', '.').trim();
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  };

  const applyManualCoords = (nextLatText: string, nextLngText: string) => {
    const lat = parseCoordinate(nextLatText);
    const lng = parseCoordinate(nextLngText);
    if (lat === null || lng === null) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError('Coordinates are out of range.');
      return;
    }
    setError(null);
    setCoords({ lat, lng });
  };

  const handleUseCurrent = async () => {
    setError(null);
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is required.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      await reverseGeocode(next.lat, next.lng);
    } catch {
      setError('Unable to read your location.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!coords) {
      setError('Select a location on the map or use your current location.');
      return;
    }
    onSelect({ coords, label: label.trim() || undefined });
  };

  const cameraCenter = useMemo(() => {
    if (coords) return [coords.lng, coords.lat] as [number, number];
    return [18.4241, -33.9249] as [number, number];
  }, [coords]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Pick a location</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {isMapLibreNativeAvailable ? (
          <View style={styles.mapWrapper}>
            <MapLibreGL.MapView
              style={StyleSheet.absoluteFill}
              mapStyle={isDark
                ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
                : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'}
              logoEnabled={false}
              attributionEnabled={false}
              onPress={(e: any) => {
                const coordsPressed = e?.geometry?.coordinates ?? e?.coordinates ?? e?.features?.[0]?.geometry?.coordinates;
                if (!coordsPressed) return;
                const next = { lng: coordsPressed[0], lat: coordsPressed[1] };
                setCoords(next);
                reverseGeocode(next.lat, next.lng);
              }}
            >
              <MapLibreGL.Camera
                centerCoordinate={cameraCenter}
                zoomLevel={11.5}
                animationMode="flyTo"
                animationDuration={500}
              />
              {coords && (
                <MapLibreGL.PointAnnotation id="selected-pin" coordinate={[coords.lng, coords.lat]}>
                  <View style={styles.pin} />
                </MapLibreGL.PointAnnotation>
              )}
            </MapLibreGL.MapView>
            <View style={styles.mapHint}>
              <Text style={styles.mapHintText}>Tap to drop a pin</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.fallback, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="map-outline" size={24} color={colors.textMuted} />
            <Text style={[styles.fallbackText, { color: colors.textMuted }]}>
              Live map requires a development build. Use GPS or enter coordinates below.
            </Text>
            <View style={styles.coordRow}>
              <View style={styles.coordField}>
                <Text style={[styles.coordLabel, { color: colors.textMuted }]}>Latitude</Text>
                <TextInput
                  placeholder="-33.9249"
                  placeholderTextColor={colors.textMuted}
                  value={latText}
                  onChangeText={(val) => {
                    setLatText(val);
                    applyManualCoords(val, lngText);
                  }}
                  keyboardType="numbers-and-punctuation"
                  style={[styles.input, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border }]}
                />
              </View>
              <View style={styles.coordField}>
                <Text style={[styles.coordLabel, { color: colors.textMuted }]}>Longitude</Text>
                <TextInput
                  placeholder="18.4241"
                  placeholderTextColor={colors.textMuted}
                  value={lngText}
                  onChangeText={(val) => {
                    setLngText(val);
                    applyManualCoords(latText, val);
                  }}
                  keyboardType="numbers-and-punctuation"
                  style={[styles.input, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border }]}
                />
              </View>
            </View>
          </View>
        )}

        <View style={styles.controls}>
          <TouchableOpacity style={[styles.gpsButton, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={handleUseCurrent}>
            {loading ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="locate" size={18} color={colors.accent} />}
            <Text style={[styles.gpsText, { color: colors.text }]}>Use current location</Text>
          </TouchableOpacity>

          <TextInput
            placeholder="Location label (optional)"
            placeholderTextColor={colors.textMuted}
            value={label}
            onChangeText={setLabel}
            style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity style={[styles.confirm, { backgroundColor: colors.accent }]} onPress={handleConfirm}>
            <Text style={[styles.confirmText, { color: isDark ? colors.bg : colors.card }]}>Use this location</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 18, fontWeight: '800' },
  mapWrapper: { flex: 1, minHeight: 260 },
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2563eb',
    borderWidth: 3,
    borderColor: '#fff',
  },
  mapHint: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  mapHintText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  fallback: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  fallbackText: { textAlign: 'center', fontSize: 12 },
  coordRow: {
    marginTop: 10,
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  coordField: {
    flex: 1,
  },
  coordLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  controls: { padding: 16, gap: 10 },
  gpsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  gpsText: { fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  confirm: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmText: { fontWeight: '800' },
  error: { color: '#b91c1c', fontWeight: '700', textAlign: 'center' },
});

export default LocationPickerModal;
