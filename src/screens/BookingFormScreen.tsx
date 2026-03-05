import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Location from 'expo-location';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { BookingCalendar } from '../components/BookingCalendar';
import { distanceKm, scorePhotographer } from '../utils/recommendation';
import { getEventPackages, quoteEventPackage, quotePaparazziSession } from '../utils/pricing';
import { formatCurrency, getCurrencyForLocale } from '../utils/format';

type Route = RouteProp<RootStackParamList, 'BookingForm'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingForm'>;

const BookingFormScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, createBooking, currentUser } = useAppData();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [timeSlot, setTimeSlot] = useState('Golden hour (4-7)');
  const [pricingMode, setPricingMode] = useState<'paparazzi' | 'event'>('paparazzi');
  const [photoCount, setPhotoCount] = useState('4');
  const [eventPackageId, setEventPackageId] = useState(getEventPackages()[0]?.id ?? 'birthday');
  const [userLatitude, setUserLatitude] = useState('');
  const [userLongitude, setUserLongitude] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);

  const photographer = useMemo(
    () => state.photographers.find((item) => item.id === params.photographerId),
    [params.photographerId, state.photographers]
  );

  if (!photographer) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This photographer is no longer available.</Text>
      </View>
    );
  }
  if (currentUser?.role && currentUser.role !== 'client') {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Only client accounts can request bookings.</Text>
      </View>
    );
  }

  const formattedDate = useMemo(() => {
    if (!selectedDate) return 'Pick a date and time slot below';
    return `${selectedDate.toDateString()} · ${timeSlot}`;
  }, [selectedDate, timeSlot]);

  const selectedPackage = useMemo(() => {
    const packages = getEventPackages();
    return packages.find((item) => item.id === eventPackageId) ?? packages[0];
  }, [eventPackageId]);

  const distanceToPhotographer = useMemo(() => {
    const lat = parseFloat(userLatitude);
    const lng = parseFloat(userLongitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
    return distanceKm({ latitude: lat, longitude: lng }, { latitude: photographer.latitude, longitude: photographer.longitude });
  }, [photographer.latitude, photographer.longitude, userLatitude, userLongitude]);

  const hasUserCoords = useMemo(() => {
    const lat = parseFloat(userLatitude);
    const lng = parseFloat(userLongitude);
    return Number.isFinite(lat) && Number.isFinite(lng);
  }, [userLatitude, userLongitude]);

  const recommendationScore = useMemo(() => {
    if (!hasUserCoords) return null;
    return scorePhotographer(
      { latitude: parseFloat(userLatitude), longitude: parseFloat(userLongitude) },
      photographer
    );
  }, [hasUserCoords, photographer, userLatitude, userLongitude]);

  const handleUseLocation = useCallback(async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Location permission', 'Enable location access to use your current position.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setUserLatitude(position.coords.latitude.toFixed(6));
      setUserLongitude(position.coords.longitude.toFixed(6));
    } catch (err) {
      Alert.alert('Location error', 'Unable to fetch your location. Please enter coordinates manually.');
    } finally {
      setLocating(false);
    }
  }, []);

  const localeCurrency = useMemo(() => getCurrencyForLocale(), []);

  const pricingQuote = useMemo(() => {
    if (pricingMode === 'event' && selectedPackage) {
      return quoteEventPackage(photographer, selectedPackage, distanceToPhotographer, localeCurrency);
    }
    const photos = Math.max(1, Number(photoCount) || 1);
    return quotePaparazziSession(photographer, distanceToPhotographer, photos, localeCurrency);
  }, [distanceToPhotographer, photoCount, photographer, pricingMode, selectedPackage, localeCurrency]);

  const handleSubmit = async () => {
    if (!selectedDate) {
      Alert.alert('Date required', 'Please add a shoot date.');
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const chosen = new Date(selectedDate);
    chosen.setHours(0, 0, 0, 0);
    if (chosen < today) {
      Alert.alert('Date invalid', 'Please choose a future date.');
      return;
    }

    try {
      setSubmitting(true);
      const normalizedDate = new Date(selectedDate);
      normalizedDate.setUTCHours(12, 0, 0, 0);
      const bookingDate = `${normalizedDate.toISOString()} | ${timeSlot}`;
      const currency = localeCurrency;
      const pricingNote = `Pricing: ${currency} ${pricingQuote.total.toFixed(2)} | Commission ${Math.round(
        pricingQuote.commission.commissionRate * 100
      )}% | Distance ${distanceToPhotographer.toFixed(1)}km | Mode ${pricingMode}`;
      const combinedNotes = [notes.trim(), pricingNote].filter(Boolean).join('\n');
      const booking = await createBooking({
        photographerId: photographer.id,
        date: bookingDate,
        package: pricingMode === 'event' ? selectedPackage?.label ?? 'Event package' : 'Paparazzi session',
        notes: combinedNotes,
        pricingMode,
        photoCount: pricingMode === 'paparazzi' ? Math.max(1, Number(photoCount) || 1) : undefined,
        eventPackageId: pricingMode === 'event' ? selectedPackage?.id : undefined,
        distanceKm: distanceToPhotographer,
        priceTotal: pricingQuote.total,
        currency,
        userLatitude: hasUserCoords ? parseFloat(userLatitude) : undefined,
        userLongitude: hasUserCoords ? parseFloat(userLongitude) : undefined,
      });
      Alert.alert('Request sent', 'Your booking was saved locally and is ready to review.', [
        {
          text: 'View booking',
          onPress: () => navigation.replace('BookingDetail', { bookingId: booking.id }),
        },
      ]);
    } catch (err) {
      Alert.alert('Unable to save', 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Photographer</Text>
      <Text style={styles.value}>{photographer.name}</Text>

      <Text style={styles.label}>Preferred date</Text>
      <View style={styles.selectedDate}>
        <Text style={styles.selectedDateText}>{formattedDate}</Text>
      </View>
      <BookingCalendar value={selectedDate} onChange={setSelectedDate} timeSlot={timeSlot} onTimeChange={setTimeSlot} />

      <Text style={styles.label}>Package</Text>
      <View style={styles.segmented}>
        <TouchableOpacity
          style={[styles.segmentButton, pricingMode === 'paparazzi' && styles.segmentButtonActive]}
          onPress={() => setPricingMode('paparazzi')}
        >
          <Text style={[styles.segmentText, pricingMode === 'paparazzi' && styles.segmentTextActive]}>Paparazzi</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentButton, pricingMode === 'event' && styles.segmentButtonActive]}
          onPress={() => setPricingMode('event')}
        >
          <Text style={[styles.segmentText, pricingMode === 'event' && styles.segmentTextActive]}>Event</Text>
        </TouchableOpacity>
      </View>
      {pricingMode === 'paparazzi' ? (
        <>
          <Text style={styles.label}>Number of photos</Text>
          <TextInput
            placeholder="4"
            value={photoCount}
            onChangeText={setPhotoCount}
            keyboardType="numeric"
            style={styles.input}
          />
        </>
      ) : (
        <>
          <Text style={styles.label}>Event package</Text>
          <View style={styles.packageRow}>
            {getEventPackages().map((pkg) => (
              <TouchableOpacity
                key={pkg.id}
                style={[styles.packageChip, eventPackageId === pkg.id && styles.packageChipActive]}
                onPress={() => setEventPackageId(pkg.id)}
              >
                <Text style={[styles.packageText, eventPackageId === pkg.id && styles.packageTextActive]}>
                  {pkg.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>Your location (optional)</Text>
      <View style={styles.rowInputs}>
        <TextInput
          placeholder="-33.92"
          value={userLatitude}
          onChangeText={setUserLatitude}
          style={[styles.input, styles.rowInput]}
          keyboardType="numeric"
        />
        <TextInput
          placeholder="18.42"
          value={userLongitude}
          onChangeText={setUserLongitude}
          style={[styles.input, styles.rowInput]}
          keyboardType="numeric"
        />
      </View>
      <TouchableOpacity style={styles.locationButton} onPress={handleUseLocation} disabled={locating}>
        <Text style={styles.locationButtonText}>{locating ? 'Locating...' : 'Use my location'}</Text>
      </TouchableOpacity>

      <View style={styles.quoteCard}>
        <Text style={styles.quoteTitle}>Price estimate</Text>
        <Text style={styles.quoteValue}>
          {formatCurrency(pricingQuote.total, pricingQuote.currency)}
        </Text>
        <Text style={styles.quoteMeta}>
          Photographer payout: {formatCurrency(pricingQuote.commission.photographerPayout, pricingQuote.currency)}
        </Text>
        <Text style={styles.quoteMeta}>
          Papz commission: {formatCurrency(pricingQuote.commission.commissionAmount, pricingQuote.currency)}
        </Text>
        {!hasUserCoords ? (
          <Text style={styles.quoteHint}>Add coordinates for distance-based pricing.</Text>
        ) : null}
      </View>

      <View style={styles.debugCard}>
        <Text style={styles.debugTitle}>Debug</Text>
        {recommendationScore ? (
          <Text style={styles.debugText}>
            Score {recommendationScore.totalScore.toFixed(2)} · Distance {recommendationScore.distanceKm.toFixed(1)}km
          </Text>
        ) : (
          <Text style={styles.debugText}>Recommendation score pending user location.</Text>
        )}
      </View>

      <Text style={styles.label}>Notes</Text>
      <TextInput
        placeholder="Shot list, vibe, must-have moments"
        value={notes}
        onChangeText={setNotes}
        style={[styles.input, styles.multiline]}
        multiline
        numberOfLines={4}
      />

      <TouchableOpacity style={styles.cta} onPress={handleSubmit} disabled={submitting}>
        <Text style={styles.ctaText}>{submitting ? 'Saving...' : 'Send request'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f7f7fb',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  muted: {
    color: '#475569',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
    marginTop: 10,
  },
  value: {
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    color: '#0f172a',
    fontWeight: '700',
  },
  selectedDate: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    marginBottom: 10,
  },
  selectedDateText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  multiline: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  cta: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  segmented: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  segmentButton: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    marginRight: 8,
  },
  segmentButtonActive: {
    backgroundColor: '#0f172a',
  },
  segmentText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  segmentTextActive: {
    color: '#fff',
  },
  packageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  packageChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
  },
  packageChipActive: {
    backgroundColor: '#0f172a',
  },
  packageText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  packageTextActive: {
    color: '#fff',
  },
  rowInputs: {
    flexDirection: 'row',
    gap: 8,
  },
  rowInput: {
    flex: 1,
  },
  locationButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#0f172a',
  },
  locationButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  quoteCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  quoteTitle: {
    fontWeight: '800',
    color: '#0f172a',
  },
  quoteValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
  },
  quoteMeta: {
    color: '#475569',
    marginTop: 4,
  },
  quoteHint: {
    color: '#b45309',
    marginTop: 6,
    fontWeight: '600',
  },
  debugCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  debugTitle: {
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  debugText: {
    color: '#475569',
  },
});

export default BookingFormScreen;
