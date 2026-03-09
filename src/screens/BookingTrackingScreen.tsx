import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Location from 'expo-location';
import { MapTracker } from '../components/MapTracker';
import { RootStackParamList } from '../navigation/types';
import { Booking, Photographer } from '../types';
import { useAppData } from '../store/AppDataContext';
import { DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates } from '../utils/geo';
import { hasSupabase, supabase } from '../config/supabaseClient';

type Route = RouteProp<RootStackParamList, 'BookingTracking'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingTracking'>;

const BookingTrackingScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, startConversationWithUser, updateBookingClientLocation, updatePhotographerLocation } = useAppData();

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

  if (!booking) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>We could not find that booking.</Text>
      </View>
    );
  }

  const openChatThread = async () => {
    if (!photographer) {
      navigation.navigate('Root', { screen: 'Chat' });
      return;
    }

    try {
      const convo = await startConversationWithUser(photographer.id, photographer.name);
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch (_err) {
      navigation.navigate('Root', { screen: 'Chat' });
    }
  };

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
            if (state.currentUser?.role === 'client') {
              setLiveClientLocation(next);
              await updateBookingClientLocation(booking.id, next.latitude, next.longitude);
            } else if (state.currentUser?.role === 'photographer') {
              setLivePhotographerLocation(next);
              await updatePhotographerLocation(next.latitude, next.longitude);
            }
          } catch (_err) {
            // do not crash on transient location sync failures
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Booking tracking</Text>
      <Text style={styles.subtitle}>Follow your photographer on OpenStreetMap tiles.</Text>

      <MapTracker client={liveClientLocation} photographer={livePhotographerLocation} status={booking.status} />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status</Text>
        <Text style={styles.cardValue}>{booking.status.toUpperCase()}</Text>
        <Text style={styles.cardMeta}>Status updates automatically after secure booking and payment confirmation.</Text>
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
        onPress={openChatThread}
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
