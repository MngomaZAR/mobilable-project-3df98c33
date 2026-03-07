import React, { useEffect, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Location from 'expo-location';
import { MapTracker } from '../components/MapTracker';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates } from '../utils/geo';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const RATE_TIERS: Record<string, string> = {
  $: 'R600–R900',
  $$: 'R1,200–R1,800',
  $$$: 'R2,400–R3,600',
};

const ModelDashboardScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state, startConversationWithUser, updatePhotographerLocation } = useAppData();

  // Find this model's profile from the models seed list (matches by role=model)
  const modelProfile = useMemo(
    () => state.models[0] ?? null,
    [state.models]
  );

  const pendingBookings = useMemo(
    () => state.bookings.filter((b) => b.modelId === modelProfile?.id || b.status === 'pending'),
    [state.bookings, modelProfile]
  );

  const activeBooking = pendingBookings[0];

  const clientLocation = useMemo(() => ({ ...DEFAULT_CAPE_TOWN_COORDINATES }), []);
  const myLocation = useMemo(() => ensureSouthAfricanCoordinates({
    latitude: modelProfile?.latitude ?? -26.2041,
    longitude: modelProfile?.longitude ?? 28.0473,
  }), [modelProfile?.latitude, modelProfile?.longitude]);

  useEffect(() => {
    if (!state.currentUser || state.currentUser.role !== 'model' || !activeBooking) return;
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;

    const startTracking = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted' || !mounted) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 8000 },
        async ({ coords }) => {
          if (!mounted) return;
          try { await updatePhotographerLocation(coords.latitude, coords.longitude); } catch (_) {}
        }
      );
    };

    startTracking();
    return () => { mounted = false; subscription?.remove(); };
  }, [activeBooking, state.currentUser, updatePhotographerLocation]);

  const openChat = async () => {
    try {
      const convo = await startConversationWithUser(modelProfile?.id ?? 'mod1', modelProfile?.name);
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch (_) {
      navigation.navigate('Root', { screen: 'Chat' });
    }
  };

  const hourlyRate = RATE_TIERS[modelProfile?.priceRange ?? '$$'] ?? 'R1,200–R1,800';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.profileRow}>
            {modelProfile?.avatar ? (
              <Image source={{ uri: modelProfile.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Ionicons name="body" size={28} color="#ec4899" />
              </View>
            )}
            <View style={styles.profileText}>
              <View style={styles.badge}>
                <Ionicons name="body" size={11} color="#fff" />
                <Text style={styles.badgeTxt}>Model</Text>
              </View>
              <Text style={styles.name}>{modelProfile?.name ?? 'Your model profile'}</Text>
              <Text style={styles.location}>{modelProfile?.location ?? 'Select a location'}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.actionPill}
            onPress={() => navigation.navigate('Root', { screen: 'Bookings' })}
          >
            <Ionicons name="calendar" size={16} color="#fff" />
            <Text style={styles.actionPillTxt}>Schedule</Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Ionicons name="star" size={18} color="#f59e0b" />
            <Text style={styles.statVal}>{modelProfile?.rating ?? '4.8'}</Text>
            <Text style={styles.statLbl}>Rating</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="calendar" size={18} color="#8b5cf6" />
            <Text style={styles.statVal}>{pendingBookings.length || 0}</Text>
            <Text style={styles.statLbl}>Pending jobs</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="chatbubble" size={18} color="#3b82f6" />
            <Text style={styles.statVal}>{state.messages.length}</Text>
            <Text style={styles.statLbl}>Messages</Text>
          </View>
        </View>

        {/* Rate Card */}
        <View style={styles.rateCard}>
          <View style={styles.rateLeft}>
            <Text style={styles.rateLabel}>Your hourly rate</Text>
            <Text style={styles.rateValue}>{hourlyRate}/hr</Text>
            <Text style={styles.rateTier}>{modelProfile?.priceRange ?? '$$'} tier • {modelProfile?.style ?? 'Editorial'}</Text>
          </View>
          <View style={styles.rateIconBox}>
            <Ionicons name="cash-outline" size={28} color="#ec4899" />
          </View>
        </View>

        {/* Tags */}
        {modelProfile?.tags && modelProfile.tags.length > 0 && (
          <View style={styles.tagsRow}>
            {modelProfile.tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagTxt}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Live Location Map */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Live route</Text>
            {activeBooking ? <Text style={styles.cardMeta}>Status: {activeBooking.status}</Text> : null}
          </View>
          <MapTracker client={clientLocation} photographer={myLocation} status={activeBooking?.status ?? 'pending'} />
          <View style={styles.callout}>
            <Text style={styles.calloutTxt}>Location shared securely only during active bookings.</Text>
          </View>
        </View>

        {/* Booking Queue */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Booking requests</Text>
            <TouchableOpacity onPress={openChat} style={styles.linkBtn}>
              <Text style={styles.linkTxt}>Open chat</Text>
            </TouchableOpacity>
          </View>
          {pendingBookings.length === 0 ? (
            <Text style={styles.empty}>No requests yet. Stay active to receive bookings.</Text>
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

        {/* Quick Actions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick actions</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.navigate('CreatePost')}>
            <Ionicons name="images-outline" size={16} color="#0f172a" />
            <Text style={styles.secondaryTxt}>Add to portfolio</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.navigate('Root', { screen: 'Map' })}>
            <Ionicons name="navigate-outline" size={16} color="#0f172a" />
            <Text style={styles.secondaryTxt}>Navigate to shoot</Text>
          </TouchableOpacity>
          {activeBooking && (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => navigation.navigate('Payment', { bookingId: activeBooking.id })}
            >
              <Ionicons name="card-outline" size={16} color="#0f172a" />
              <Text style={styles.secondaryTxt}>Collect payment</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f7fb' },
  container: { padding: 16, paddingBottom: 120, backgroundColor: '#f7f7fb' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  profileRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 56, height: 56, borderRadius: 28, marginRight: 12 },
  avatarFallback: { backgroundColor: '#fce7f3', alignItems: 'center', justifyContent: 'center' },
  profileText: { flex: 1 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#ec4899', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start', marginBottom: 4,
  },
  badgeTxt: { color: '#fff', fontWeight: '800', fontSize: 11 },
  name: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  location: { color: '#64748b', fontSize: 13, marginTop: 2 },
  actionPill: {
    backgroundColor: '#ec4899', paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  actionPillTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14,
    alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 4 },
  },
  statVal: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginTop: 6 },
  statLbl: { color: '#475569', fontWeight: '600', fontSize: 12, marginTop: 2 },
  rateCard: {
    backgroundColor: '#fdf2f8', borderRadius: 16, padding: 16, marginBottom: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#f9a8d4',
  },
  rateLeft: { flex: 1 },
  rateLabel: { color: '#9d174d', fontWeight: '700', fontSize: 13 },
  rateValue: { fontSize: 26, fontWeight: '900', color: '#0f172a', marginTop: 2 },
  rateTier: { color: '#64748b', fontSize: 12, marginTop: 2 },
  rateIconBox: { width: 52, height: 52, backgroundColor: '#fce7f3', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  tag: { backgroundColor: '#f1f5f9', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  tagTxt: { color: '#475569', fontWeight: '700', fontSize: 12 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb', marginBottom: 14,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  cardMeta: { color: '#475569' },
  callout: {
    marginTop: 12, borderRadius: 12, backgroundColor: '#fdf2f8',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#f9a8d4', paddingVertical: 10, paddingHorizontal: 12,
  },
  calloutTxt: { color: '#9d174d', fontWeight: '600', fontSize: 12 },
  linkBtn: { padding: 6 },
  linkTxt: { color: '#ec4899', fontWeight: '700' },
  empty: { color: '#475569', marginTop: 4, fontSize: 13 },
  queueRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb',
  },
  queueTitle: { fontWeight: '700', color: '#0f172a' },
  queueMeta: { color: '#475569', fontSize: 12 },
  secondaryBtn: {
    marginTop: 10, backgroundColor: '#f1f5f9', padding: 12,
    borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  secondaryTxt: { color: '#0f172a', fontWeight: '700' },
});

export default ModelDashboardScreen;
