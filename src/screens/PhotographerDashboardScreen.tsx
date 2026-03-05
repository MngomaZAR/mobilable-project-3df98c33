import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { MapTracker } from '../components/MapTracker';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates } from '../utils/geo';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const PhotographerDashboardScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state, updateBookingStatus } = useAppData();

  const activeBooking = useMemo(
    () => state.bookings.find((booking) => booking.status === 'pending' || booking.status === 'accepted') ?? state.bookings[0],
    [state.bookings]
  );
  const pendingBookings = useMemo(
    () => state.bookings.filter((booking) => booking.status === 'pending'),
    [state.bookings]
  );
  const photographerProfile = useMemo(
    () => state.photographers.find((p) => p.id === activeBooking?.photographerId) ?? state.photographers[0],
    [activeBooking?.photographerId, state.photographers]
  );

  const clientLocation = useMemo(() => {
    return { ...DEFAULT_CAPE_TOWN_COORDINATES };
  }, []);

  const photographerLocation = useMemo(() => {
    return ensureSouthAfricanCoordinates({
      latitude: photographerProfile?.latitude ?? -26.2041,
      longitude: photographerProfile?.longitude ?? 28.0473,
    });
  }, [photographerProfile?.latitude, photographerProfile?.longitude]);

  const advanceActive = async () => {
    if (!activeBooking) return;
    await updateBookingStatus(activeBooking.id);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>Photographer mode</Text>
            <Text style={styles.title}>You are live for new requests</Text>
            <Text style={styles.subtitle}>Track assignments, chat with clients, and move jobs forward.</Text>
          </View>
          <TouchableOpacity style={styles.actionPill} onPress={() => navigation.navigate('Root', { screen: 'Bookings' })}>
            <Ionicons name="calendar" size={18} color="#fff" />
            <Text style={styles.actionPillText}>View schedule</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Active jobs</Text>
            <Text style={styles.statValue}>{pendingBookings.length || 1}</Text>
            <Text style={styles.statMeta}>Accept and route to client</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Inbox</Text>
            <Text style={styles.statValue}>{state.messages.length}</Text>
            <Text style={styles.statMeta}>Realtime chat powered by Supabase</Text>
          </View>
        </View>

        <View style={styles.mapCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Live route</Text>
            {activeBooking ? <Text style={styles.cardMeta}>Status: {activeBooking.status}</Text> : null}
          </View>
          <MapTracker client={clientLocation} photographer={photographerLocation} status={activeBooking?.status ?? 'pending'} />
          <TouchableOpacity style={styles.primaryButton} onPress={advanceActive} disabled={!activeBooking}>
            <Text style={styles.primaryButtonText}>{activeBooking ? 'Advance status' : 'Awaiting booking'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Requests queue</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Root', { screen: 'Chat' })} style={styles.smallLink}>
              <Text style={styles.smallLinkText}>Open chat</Text>
            </TouchableOpacity>
          </View>
          {pendingBookings.length === 0 ? (
            <Text style={styles.empty}>No new requests. Stay online to auto-accept nearby shoots.</Text>
          ) : (
            pendingBookings.map((booking) => (
              <TouchableOpacity
                key={booking.id}
                style={styles.queueRow}
                onPress={() => navigation.navigate('BookingDetail', { bookingId: booking.id })}
              >
                <View>
                  <Text style={styles.queueTitle}>{booking.package}</Text>
                  <Text style={styles.queueMeta}>{new Date(booking.date).toLocaleString()}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#0f172a" />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next steps</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('Payment', { bookingId: undefined })}>
            <Ionicons name="card-outline" size={16} color="#0f172a" />
            <Text style={styles.secondaryText}>Collect payment</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('Root', { screen: 'Map' })}>
            <Ionicons name="navigate-outline" size={16} color="#0f172a" />
            <Text style={styles.secondaryText}>Map to client</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f7f7fb',
  },
  container: {
    padding: 16,
    paddingBottom: 120,
    backgroundColor: '#f7f7fb',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  eyebrow: {
    color: '#2563eb',
    fontWeight: '800',
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    color: '#475569',
    marginTop: 4,
  },
  actionPill: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionPillText: {
    color: '#fff',
    fontWeight: '700',
    marginLeft: 8,
  },
  statsRow: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginRight: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
  },
  statLabel: {
    color: '#475569',
    fontWeight: '700',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  statMeta: {
    color: '#475569',
    marginTop: 4,
  },
  mapCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    marginBottom: 14,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  cardMeta: {
    color: '#475569',
  },
  primaryButton: {
    marginTop: 12,
    backgroundColor: '#0f172a',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
  smallLink: {
    padding: 6,
  },
  smallLinkText: {
    color: '#2563eb',
    fontWeight: '700',
  },
  empty: {
    color: '#475569',
    marginTop: 4,
  },
  queueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  queueTitle: {
    fontWeight: '700',
    color: '#0f172a',
  },
  queueMeta: {
    color: '#475569',
  },
  secondaryButton: {
    marginTop: 10,
    backgroundColor: '#f1f5f9',
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  secondaryText: {
    color: '#0f172a',
    fontWeight: '700',
    marginLeft: 8,
  },
});

export default PhotographerDashboardScreen;
