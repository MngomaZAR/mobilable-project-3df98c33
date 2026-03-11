import React, { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Location from 'expo-location';
import { MapTracker } from '../components/MapTracker';
import { useAuth } from '../store/AuthContext';
import { useBooking } from '../store/BookingContext';
import { useMessaging } from '../store/MessagingContext';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates } from '../utils/geo';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const PhotographerDashboardScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { currentUser } = useAuth();
  const { bookings } = useBooking();
  const { startConversationWithUser } = useMessaging();
  const { updatePhotographerLocation } = useAppData();

  const activeBooking = useMemo(
    () => bookings.find((booking) => booking.status === 'pending' || booking.status === 'accepted') ?? bookings[0],
    [bookings]
  );
  const pendingBookings = useMemo(
    () => bookings.filter((booking) => booking.status === 'pending'),
    [bookings]
  );
  
  const { state } = useAppData();
  
  /**
   * Single source of truth for earnings — uses state.earnings (from the earnings table).
   * If the earnings table is empty (e.g., first session), falls back to completed bookings.
   * This avoids double-counting a booking that also has an earnings row.
   */
  const earnings = useMemo(() => {
    const earningsRows = state.earnings || [];

    if (earningsRows.length > 0) {
      // Primary: use the earnings table (covers bookings, tips, subscriptions, video calls)
      return earningsRows.reduce((acc, e) => {
        const amount = Number(e.amount || 0);
        const commRate = 0.30; // platform commission
        return {
          total: acc.total + amount,
          commission: acc.commission + Math.round(amount * commRate * 100) / 100,
          net: acc.net + Math.round(amount * (1 - commRate) * 100) / 100,
        };
      }, { total: 0, net: 0, commission: 0 });
    }

    // Fallback: derive from completed/accepted bookings when earnings table is empty
    return bookings
      .filter(b => b.status === 'completed' || b.status === 'accepted')
      .reduce((acc, b) => ({
        total: acc.total + (b.total_amount || 0),
        net: acc.net + (b.payout_amount || 0),
        commission: acc.commission + (b.commission_amount || 0),
      }), { total: 0, net: 0, commission: 0 });
  }, [bookings, state.earnings]);

  const photographerProfile = useMemo(
    () => state.photographers.find((p) => p.id === activeBooking?.photographer_id) ?? state.photographers[0],
    [activeBooking?.photographer_id, state.photographers]
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

  useEffect(() => {
    // Only start GPS tracking on ACCEPTED bookings — not pending.
    // Prevents leaking photographer location to the client before they accept.
    if (!currentUser || currentUser.role !== 'photographer' || activeBooking?.status !== 'accepted') return;
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;

    const startTracking = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted' || !mounted) return;

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 20,
          timeInterval: 8000,
        },
        async ({ coords }) => {
          if (!mounted) return;
          const { latitude, longitude } = coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
          try {
            await updatePhotographerLocation(latitude, longitude);
          } catch (_err) {
            // soft-fail: tracking should not crash dashboard
          }
        }
      );
    };

    startTracking();

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [activeBooking, currentUser, updatePhotographerLocation]);

  const openChatThread = async () => {
    if (!photographerProfile) {
      navigation.navigate('Root', { screen: 'Chat' });
      return;
    }

    try {
      const convo = await startConversationWithUser(photographerProfile.id, photographerProfile.name);
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch (_err) {
      navigation.navigate('Root', { screen: 'Chat' });
    }
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
            <Text style={styles.statValue}>{pendingBookings.length}</Text>
            <Text style={styles.statMeta}>Accept and route to client</Text>
          </View>
          <View style={[styles.statCard, { marginRight: 0 }]}>
            <Text style={styles.statLabel}>Earnings</Text>
            <Text style={styles.statValue}>R{earnings.net.toLocaleString()}</Text>
            <Text style={styles.statMeta}>Net from {bookings.length} shoots</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Financial summary</Text>
          <View style={styles.financeRow}>
            <Text style={styles.financeLabel}>Total revenue</Text>
            <Text style={styles.financeValue}>R{earnings.total.toLocaleString()}</Text>
          </View>
          <View style={styles.financeRow}>
            <Text style={styles.financeLabel}>Platform fees (30%)</Text>
            <Text style={styles.financeValue}>-R{earnings.commission.toLocaleString()}</Text>
          </View>
          <View style={[styles.financeRow, styles.financeRowTotal]}>
            <Text style={styles.financeTotalLabel}>Net payout</Text>
            <Text style={styles.financeTotalValue}>R{earnings.net.toLocaleString()}</Text>
          </View>
        </View>

        <View style={styles.mapCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Live route</Text>
            {activeBooking ? <Text style={styles.cardMeta}>Status: {activeBooking.status}</Text> : null}
          </View>
          <MapTracker client={clientLocation} photographer={photographerLocation} status={activeBooking?.status ?? 'pending'} />
          <View style={styles.infoCallout}>
            <Text style={styles.infoCalloutText}>Status updates are confirmed through secure booking and payment workflows.</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Available Models</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Root', { screen: 'Feed' })}>
              <Text style={styles.viewAll}>Collaborate</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
            {(state.models || []).slice(0, 8).map(model => (
              <TouchableOpacity 
                key={model.id} 
                style={styles.modelPill}
                onPress={() => navigation.navigate('UserProfile', { userId: model.id })}
              >
                <Image source={{ uri: model.avatar_url }} style={styles.modelAvatar} />
                <Text style={styles.modelName} numberOfLines={1}>{model.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Requests queue</Text>
            <TouchableOpacity onPress={openChatThread} style={styles.smallLink}>
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
                  <Text style={styles.queueTitle}>{booking.package_type}</Text>
                  <Text style={styles.queueMeta}>{new Date(booking.booking_date).toLocaleString()}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#0f172a" />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next steps</Text>
          <TouchableOpacity
            style={[styles.secondaryButton, !activeBooking && styles.secondaryButtonDisabled]}
            disabled={!activeBooking}
            onPress={() => activeBooking && navigation.navigate('Payment', { bookingId: activeBooking.id })}
          >
            <Ionicons name="card-outline" size={16} color="#0f172a" />
            <Text style={styles.secondaryText}>{activeBooking ? 'Collect payment' : 'No booking selected'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('Root', { screen: 'Map' })}>
            <Ionicons name="navigate-outline" size={16} color="#0f172a" />
            <Text style={styles.secondaryText}>Map to client</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryButton, { backgroundColor: '#eff6ff' }]} onPress={() => navigation.navigate('Availability')}>
            <Ionicons name="time-outline" size={16} color="#2563eb" />
            <Text style={[styles.secondaryText, { color: '#2563eb' }]}>Set working hours</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  container: {
    padding: 16,
    paddingBottom: 120,
    backgroundColor: '#0f172a',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  eyebrow: {
    color: '#8b5cf6',
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#94a3b8',
    marginTop: 6,
    lineHeight: 20,
  },
  actionPill: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  actionPillText: {
    color: '#fff',
    fontWeight: '700',
    marginLeft: 8,
  },
  statsRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 18,
    padding: 18,
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  statLabel: {
    color: '#64748b',
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    marginTop: 4,
  },
  statMeta: {
    color: '#94a3b8',
    marginTop: 6,
    fontSize: 13,
  },
  mapCard: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },
  cardMeta: {
    color: '#8b5cf6',
    fontWeight: '700',
    textTransform: 'uppercase',
    fontSize: 11,
  },
  infoCallout: {
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  infoCalloutText: {
    color: '#8b5cf6',
    fontWeight: '600',
    fontSize: 14,
  },
  smallLink: {
    padding: 6,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderRadius: 8,
  },
  smallLinkText: {
    color: '#8b5cf6',
    fontWeight: '700',
  },
  empty: {
    color: '#64748b',
    marginTop: 8,
    textAlign: 'center',
  },
  queueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
  },
  queueTitle: {
    fontWeight: '700',
    color: '#fff',
    fontSize: 16,
  },
  queueMeta: {
    color: '#64748b',
    marginTop: 2,
  },
  secondaryButton: {
    marginTop: 12,
    backgroundColor: '#0f172a',
    padding: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryButtonDisabled: {
    opacity: 0.4,
  },
  secondaryText: {
    color: '#fff',
    fontWeight: '700',
    marginLeft: 10,
  },
  financeTotalValue: {
    color: '#10b981',
    fontWeight: '900',
    fontSize: 22,
  },
  financeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
  },
  financeRowTotal: {
    borderBottomWidth: 0,
    marginTop: 10,
    paddingTop: 14,
    borderTopWidth: 2,
    borderTopColor: '#262626',
  },
  financeLabel: {
    color: '#94a3b8',
    fontSize: 14,
  },
  financeValue: {
    color: '#fff',
    fontWeight: '600',
  },
  financeTotalLabel: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 18,
  },
  horizontalList: {
    marginTop: 10,
    marginBottom: 10,
  },
  modelPill: {
    alignItems: 'center',
    marginRight: 16,
    width: 70,
  },
  modelAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#334155',
    borderWidth: 2,
    borderColor: '#8b5cf6',
  },
  modelName: {
    color: '#fff',
    fontSize: 12,
    marginTop: 6,
    fontWeight: '600',
    textAlign: 'center',
  },
  viewAll: {
    color: '#8b5cf6',
    fontWeight: '700',
  },
});

export default PhotographerDashboardScreen;
