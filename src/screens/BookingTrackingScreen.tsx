import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { MapTracker } from '../components/MapTracker';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { DEFAULT_CAPE_TOWN_COORDINATES, validateSouthAfricanLocation } from '../utils/geo';

type Route = RouteProp<RootStackParamList, 'BookingTracking'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingTracking'>;

const BookingTrackingScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, updateBookingStatus } = useAppData();

  const booking = useMemo(
    () => state.bookings.find((item) => item.id === params.bookingId),
    [params.bookingId, state.bookings]
  );
  const photographer = useMemo(
    () => state.photographers.find((p) => p.id === booking?.photographerId),
    [booking?.photographerId, state.photographers]
  );

  const clientLocation = useMemo(() => {
    if (photographer) {
      const coords = {
        latitude: photographer.latitude + 0.25,
        longitude: photographer.longitude + 0.12,
      };
      validateSouthAfricanLocation(coords.latitude, coords.longitude);
      return coords;
    }
    const fallback = { ...DEFAULT_CAPE_TOWN_COORDINATES };
    validateSouthAfricanLocation(fallback.latitude, fallback.longitude);
    return fallback;
  }, [photographer]);

  const photographerLocation = useMemo(() => {
    const coords = {
      latitude: photographer?.latitude ?? clientLocation.latitude - 0.1,
      longitude: photographer?.longitude ?? clientLocation.longitude - 0.1,
    };
    validateSouthAfricanLocation(coords.latitude, coords.longitude);
    return coords;
  }, [clientLocation.latitude, clientLocation.longitude, photographer?.latitude, photographer?.longitude]);

  if (!booking) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>We could not find that booking.</Text>
      </View>
    );
  }

  const advance = async () => {
    await updateBookingStatus(booking.id);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Booking tracking</Text>
      <Text style={styles.subtitle}>Follow your photographer on OpenStreetMap tiles.</Text>

      <MapTracker client={clientLocation} photographer={photographerLocation} status={booking.status} />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status</Text>
        <Text style={styles.cardValue}>{booking.status.toUpperCase()}</Text>
        <Text style={styles.cardMeta}>Tap to advance locally as webhooks confirm payments.</Text>
        <TouchableOpacity style={styles.cta} onPress={advance}>
          <Text style={styles.ctaText}>Advance status</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.secondary, styles.rowButton]}
          onPress={() => navigation.navigate('BookingDetail', { bookingId: booking.id })}
        >
          <Text style={styles.secondaryText}>Booking detail</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondary, styles.rowButton]}
          onPress={() => navigation.navigate('Payment', { bookingId: booking.id })}
        >
          <Text style={styles.secondaryText}>Payments</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.secondary}
        onPress={() => navigation.navigate('Root', { screen: 'Chat' })}
      >
        <Text style={styles.secondaryText}>Open chat</Text>
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
  card: {
    marginTop: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardValue: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  cardMeta: {
    marginTop: 4,
    color: '#475569',
  },
  cta: {
    marginTop: 10,
    backgroundColor: '#0f172a',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    marginTop: 12,
  },
  rowButton: {
    flex: 1,
    marginRight: 8,
  },
  secondary: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
  },
  secondaryText: {
    color: '#0f172a',
    fontWeight: '700',
  },
});

export default BookingTrackingScreen;
