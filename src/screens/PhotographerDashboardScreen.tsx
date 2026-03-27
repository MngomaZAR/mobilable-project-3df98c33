import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, RefreshControl, ScrollView, StyleSheet, Text,
  TouchableOpacity, View, Image, Switch, Modal, TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { MapTracker } from '../components/MapTracker';
import { useAuth } from '../store/AuthContext';
import { useBooking } from '../store/BookingContext';
import { useMessaging } from '../store/MessagingContext';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { supabase } from '../config/supabaseClient';
import { DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates } from '../utils/geo';
import { NewMessageModal } from '../components/NewMessageModal';
import HowItWorksCard from '../components/HowItWorksCard';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const PhotographerDashboardScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { currentUser: authUser } = useAuth();
  const { bookings, acceptBooking, declineBooking, refreshBookings, updateBookingStatus } = useBooking();
  const { startConversationWithUser } = useMessaging();
  const { state, updatePhotographerLocation, fetchEarnings, fetchSubscriptions, fetchCredits, fetchBookings } = useAppData();
  const currentUser = authUser ?? state.currentUser;
  const insets = useSafeAreaInsets();
  const [isOnline, setIsOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [showEarningsDetail, setShowEarningsDetail] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);

  const activeBooking = useMemo(
    () => bookings.find(b => b.status === 'accepted') ?? bookings.find(b => b.status === 'pending'),
    [bookings]
  );
  const pendingBookings = useMemo(() => bookings.filter(b => b.status === 'pending'), [bookings]);
  const acceptedBookings = useMemo(() => bookings.filter(b => b.status === 'accepted'), [bookings]);
  const completedBookings = useMemo(() => bookings.filter(b => b.status === 'completed' || b.status === 'paid_out'), [bookings]);
  const kycApproved = (currentUser?.kyc_status ?? state.currentUser?.kyc_status) === 'approved';

  useEffect(() => {
    const profile = state.profiles.find((p: any) => p.id === currentUser?.id) as any;
    if (profile?.availability_status) {
      setIsOnline(profile.availability_status === 'online');
    }
  }, [currentUser?.id, state.profiles]);

  const earnings = useMemo(() => {
    const earningsRows = state.earnings ?? [];
    if (earningsRows.length > 0) {
      return earningsRows.reduce((acc, e) => {
        const amount = Number(e.amount || 0);
        const gross = Number((e as any).gross_amount || amount / 0.7);
        return {
          total: acc.total + gross,
          commission: acc.commission + (gross - amount),
          net: acc.net + amount,
          count: acc.count + 1,
        };
      }, { total: 0, net: 0, commission: 0, count: 0 });
    }
    return bookings
      .filter(b => b.status === 'completed' || b.status === 'paid_out' || b.status === 'accepted')
      .reduce((acc, b) => ({
        total: acc.total + (b.total_amount || 0),
        net: acc.net + (b.payout_amount || 0),
        commission: acc.commission + (b.commission_amount || 0),
        count: acc.count + 1,
      }), { total: 0, net: 0, commission: 0, count: 0 });
  }, [bookings, state.earnings]);

  const talentProfile = useMemo(() => {
    if (currentUser?.role === 'model') {
      return state.models.find((m) => m.id === currentUser?.id);
    }
    return state.photographers.find((p) => p.id === currentUser?.id);
  }, [currentUser, state.photographers, state.models]);

  const talentLocation = useMemo(
    () =>
      ensureSouthAfricanCoordinates({
        latitude: talentProfile?.latitude ?? -26.2041,
        longitude: talentProfile?.longitude ?? 28.0473,
      }),
    [talentProfile?.latitude, talentProfile?.longitude]
  );

  const clientLocation = useMemo(() => ensureSouthAfricanCoordinates({
    latitude: activeBooking?.user_latitude ?? DEFAULT_CAPE_TOWN_COORDINATES.latitude,
    longitude: activeBooking?.user_longitude ?? DEFAULT_CAPE_TOWN_COORDINATES.longitude,
  }), [activeBooking?.user_latitude, activeBooking?.user_longitude]);

  // GPS tracking for accepted bookings
  useEffect(() => {
    if (!currentUser || !isOnline || activeBooking?.status !== 'accepted') return;
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;

    const startTracking = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || !mounted) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 8000 },
        async ({ coords }) => {
          if (!mounted) return;
          const { latitude, longitude } = coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
          try { await updatePhotographerLocation(latitude, longitude, undefined, position.coords.accuracy); } catch { /* soft fail */ }
        }
      );
    };

    startTracking();
    return () => { mounted = false; subscription?.remove(); };
  }, [activeBooking?.status, currentUser, isOnline, updatePhotographerLocation]);

  useEffect(() => {
    if (!kycApproved) {
      setIsOnline(false);
    }
  }, [kycApproved]);

  const handleOnlineToggle = async (nextValue: boolean) => {
    if (!kycApproved) {
      Alert.alert('Verification required', 'Complete KYC to go online and accept jobs.');
      return;
    }
    setIsOnline(nextValue);
    try {
      const providerTable = currentUser?.role === 'model' ? 'models' : 'photographers';
      await supabase
        .from('profiles')
        .update({ availability_status: nextValue ? 'online' : 'offline' })
        .eq('id', currentUser?.id);
      await supabase
        .from(providerTable)
        .update({ is_online: nextValue })
        .eq('id', currentUser?.id);
      const userId = currentUser?.id;
      await Promise.allSettled([
        fetchBookings(userId),
        userId ? fetchEarnings(userId) : Promise.resolve(),
        userId ? fetchSubscriptions(userId) : Promise.resolve(),
        userId ? fetchCredits(userId) : Promise.resolve(),
      ]);
    } catch {
      // soft-fail
    }
  };

  const handleAcceptBooking = async (bookingId: string) => {
    setAcceptingId(bookingId);
    try {
      await acceptBooking(bookingId);
      Alert.alert('Booking Accepted', 'The client has been notified. Navigate to their location.');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not accept booking.');
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDeclineBooking = async (bookingId: string) => {
    Alert.alert('Decline Booking', 'Are you sure? The client will be refunded.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive', onPress: async () => {
          try {
            await declineBooking(bookingId);
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? 'Could not decline booking.');
          }
        },
      },
    ]);
  };

  const handleCompleteBooking = async (bookingId: string) => {
    Alert.alert('Mark Complete', 'Confirm this session is done? Payment will be processed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Complete', onPress: async () => {
          try {
            await updateBookingStatus(bookingId, 'completed');

            // Release escrow to providers
            const { error: escrowError } = await supabase.functions.invoke('escrow-release', {
              body: { booking_id: bookingId }
            });
            if (escrowError) {
              console.error('Escrow release failed:', escrowError);
              // Non-blocking - escrow can be retried manually from admin dashboard
            }

            await refreshBookings();
            Alert.alert('Session Complete', 'Your earnings have been recorded.');
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? 'Could not mark as complete.');
          }
        },
      },
    ]);
  };

  const openChatWithClient = async (clientId?: string | null, clientName?: string) => {
    if (!clientId) {
      navigation.navigate('Root', { screen: 'Chat' });
      return;
    }
    try {
      const convo = await startConversationWithUser(clientId, clientName ?? 'Client');
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch {
      navigation.navigate('Root', { screen: 'Chat' });
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    const userId = currentUser?.id;
    try {
      await Promise.allSettled([
        refreshBookings(),
        fetchBookings(userId),
        userId ? fetchEarnings(userId) : Promise.resolve(),
        userId ? fetchSubscriptions(userId) : Promise.resolve(),
        userId ? fetchCredits(userId) : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      const run = async () => {
        if (!active) return;
        const userId = currentUser?.id;
        await Promise.allSettled([
          refreshBookings(),
          fetchBookings(userId),
          userId ? fetchEarnings(userId) : Promise.resolve(),
          userId ? fetchSubscriptions(userId) : Promise.resolve(),
          userId ? fetchCredits(userId) : Promise.resolve(),
        ]);
      };
      run();
      const timer = setInterval(run, 60000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [currentUser?.id, fetchCredits, fetchEarnings, fetchSubscriptions, refreshBookings]),
  );

  return (
    <SafeAreaView edges={['left', 'right']} style={s.safeArea}>
      <ScrollView
        contentContainerStyle={[s.container, { paddingTop: Math.max(8, insets.top + 2), paddingBottom: Math.max(120, insets.bottom + 96) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8b5cf6" />}
      >
        {/* Header */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.eyebrow}>{currentUser?.role === 'model' ? 'Model Mode' : 'Photographer Mode'}</Text>
            <Text style={s.title} numberOfLines={1}>
              {currentUser?.full_name?.split(' ')[0] ?? (currentUser?.role === 'model' ? 'Model' : 'Photographer')}'s Dashboard
            </Text>
          </View>
          <TouchableOpacity style={s.newMsgBtn} onPress={() => setShowNewMessage(true)}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#fff" />
          </TouchableOpacity>
          <View style={s.onlineRow}>
            <Text style={[s.onlineLabel, { color: isOnline ? '#10b981' : '#64748b' }]}>
              {isOnline ? 'LIVE' : 'OFFLINE'}
            </Text>
            <Switch
              value={isOnline}
              onValueChange={handleOnlineToggle}
              disabled={!kycApproved}
              trackColor={{ false: '#334155', true: '#10b981' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          <TouchableOpacity style={s.statCard} onPress={() => setShowEarningsDetail(true)}>
            <Text style={s.statLabel}>Net Earnings</Text>
            <Text style={s.statValue}>R{earnings.net.toLocaleString('en-ZA')}</Text>
            <Text style={s.statMeta}>Tap for breakdown</Text>
          </TouchableOpacity>
          <View style={[s.statCard, { marginRight: 0 }]}>
            <Text style={s.statLabel}>Queue</Text>
            <Text style={[s.statValue, { color: pendingBookings.length > 0 ? '#f59e0b' : '#fff' }]}>
              {pendingBookings.length}
            </Text>
            <Text style={s.statMeta}>{acceptedBookings.length} active | {completedBookings.length} done</Text>
          </View>
        </View>

        <View style={s.priorityCard}>
          <Text style={s.cardTitle}>Today Priorities</Text>
          <View style={s.priorityRow}>
            <View style={s.priorityPill}>
              <Text style={s.priorityValue}>{pendingBookings.length}</Text>
              <Text style={s.priorityLabel}>Pending</Text>
            </View>
            <View style={s.priorityPill}>
              <Text style={s.priorityValue}>{acceptedBookings.length}</Text>
              <Text style={s.priorityLabel}>Active</Text>
            </View>
            <View style={s.priorityPill}>
              <Text style={[s.priorityValue, { color: isOnline ? '#10b981' : '#64748b' }]}>{isOnline ? 'ON' : 'OFF'}</Text>
              <Text style={s.priorityLabel}>Availability</Text>
            </View>
          </View>
        </View>

        <HowItWorksCard
          title="How Request Actions Work"
          persistKey="photographer-dashboard-actions-how"
          items={[
            'Accept reserves the session and updates client tracking + ETA flows.',
            'Decline closes the request and returns client flow to matching immediately.',
            'Mark Done records completion and triggers payout release processing.',
            'Disputes or policy issues should be opened from booking detail for audit tracking.',
          ]}
          containerStyle={s.howCard}
          titleStyle={s.howTitle}
          itemStyle={s.howItem}
        />

        {/* Pending booking requests */}
        {pendingBookings.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>New Requests</Text>
              <Text style={s.cardMeta}>{pendingBookings.length} waiting</Text>
            </View>
            {pendingBookings.map(booking => (
              <View key={booking.id} style={s.requestCard}>
                <View style={s.requestInfo}>
                  <Text style={s.requestPackage}>{booking.package_type ?? 'Photography'}</Text>
                  <Text style={s.requestDate}>
                    {booking.booking_date
                      ? new Date(booking.booking_date).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
                      : 'Date TBD'}
                  </Text>
                  <Text style={s.requestAmount}>R{(booking.total_amount ?? 0).toLocaleString('en-ZA')}</Text>
                </View>
                <View style={s.requestActions}>
                  <TouchableOpacity
                    style={s.acceptBtn}
                    onPress={() => handleAcceptBooking(booking.id)}
                    disabled={acceptingId === booking.id}
                  >
                    <Ionicons name="checkmark" size={18} color="#fff" />
                    <Text style={s.acceptBtnText}>{acceptingId === booking.id ? '...' : 'Accept'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.declineBtn} onPress={() => handleDeclineBooking(booking.id)}>
                    <Ionicons name="close" size={18} color="#ef4444" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.chatBtn}
                    onPress={() => openChatWithClient(booking.client_id, 'Client')}
                  >
                    <Ionicons name="chatbubble-outline" size={18} color="#8b5cf6" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Active accepted bookings */}
        {acceptedBookings.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Active Bookings</Text>
            {acceptedBookings.map(booking => (
              <View key={booking.id} style={s.activeCard}>
                <View style={{ flex: 1 }}>
                  <Text style={s.requestPackage}>{booking.package_type ?? 'Session'}</Text>
                  <Text style={s.requestDate}>
                    {booking.booking_date
                      ? new Date(booking.booking_date).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
                      : 'In progress'}
                  </Text>
                </View>
                <View style={s.activeActions}>
                  <TouchableOpacity
                    style={s.completeBtn}
                    onPress={() => handleCompleteBooking(booking.id)}
                  >
                    <Text style={s.completeBtnText}>Mark Done</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.chatLabelBtn}
                    onPress={() => openChatWithClient(booking.client_id, 'Client')}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color="#8b5cf6" />
                    <Text style={s.chatLabelText}>Message</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Live map */}
        <View style={s.mapCard}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Live Route</Text>
            {activeBooking && (
              <Text style={[s.cardMeta, { color: activeBooking.status === 'accepted' ? '#10b981' : '#f59e0b' }]}>
                {activeBooking.status.toUpperCase()}
              </Text>
            )}
          </View>
          <MapTracker
            client={clientLocation}
            photographer={talentLocation}
            status={activeBooking?.status ?? 'pending'}
          />
          <TouchableOpacity style={s.navBtn} onPress={() => navigation.navigate('Root', { screen: 'Map' })}>
            <Ionicons name="navigate" size={16} color="#8b5cf6" />
            <Text style={s.navBtnText}>Open Full Map</Text>
          </TouchableOpacity>
        </View>

        {/* Quick tools */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Quick Tools</Text>
          <View style={s.toolGrid}>
            {[
              { icon: 'calendar', label: 'Schedule', color: '#3b82f6', action: () => navigation.navigate('Root', { screen: 'Bookings' }) },
              { icon: 'time', label: 'Availability', color: '#8b5cf6', action: () => navigation.navigate('Availability') },
              { icon: 'chatbubbles', label: 'Messages', color: '#10b981', action: () => navigation.navigate('Root', { screen: 'Chat' }) },
              { icon: 'document-text', label: 'Model Release', color: '#f59e0b', action: () => activeBooking ? navigation.navigate('ModelRelease', { bookingId: activeBooking.id }) : Alert.alert('No active booking', 'Accept a booking first.') },
              { icon: 'card', label: 'Payments', color: '#ec4899', action: () => navigation.navigate('PaymentHistory') },
              { icon: 'wallet', label: 'Payouts', color: '#14b8a6', action: () => navigation.navigate('PayoutMethods') },
              { icon: 'stats-chart', label: 'Earnings', color: '#06b6d4', action: () => navigation.navigate('EarningsDashboard') },
              { icon: 'camera', label: 'Equipment', color: '#c9a44a', action: () => (navigation as any).navigate('EquipmentSetup') },
              { icon: kycApproved ? 'shield-checkmark' : 'shield-outline', label: kycApproved ? 'Verified' : 'Verify ID', color: kycApproved ? '#22c55e' : '#f59e0b', action: () => (navigation as any).navigate('KYC') },
            ].map(tool => (
              <TouchableOpacity key={tool.label} style={s.toolBtn} onPress={tool.action}>
                <View style={[s.toolIcon, { backgroundColor: tool.color + '20' }]}>
                  <Ionicons name={tool.icon as any} size={22} color={tool.color} />
                </View>
                <Text style={s.toolLabel}>{tool.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Available models to collaborate with */}
        {(state.models ?? []).length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>Models to Collaborate</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Root', { screen: 'Feed' })}>
                <Text style={s.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(state.models ?? []).slice(0, 8).map(model => (
                <TouchableOpacity
                  key={model.id}
                  style={s.modelPill}
                  onPress={() => navigation.navigate('UserProfile', { userId: model.id })}
                >
                  <Image source={{ uri: model.avatar_url ?? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200' }} style={s.modelAvatar} />
                  <Text style={s.modelName} numberOfLines={1}>{model.name}</Text>
                  <TouchableOpacity
                    style={s.modelChatBtn}
                    onPress={() => openChatWithClient(model.id, model.name)}
                  >
                    <Text style={s.modelChatBtnText}>Chat</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Profile settings CTA */}
        <TouchableOpacity style={s.settingsCard} onPress={() => navigation.navigate('AccountConfig')}>
          <Ionicons name="settings-outline" size={20} color="#8b5cf6" />
          <Text style={s.settingsText}>Profile & Portfolio Settings</Text>
          <Ionicons name="chevron-forward" size={18} color="#64748b" />
        </TouchableOpacity>
      </ScrollView>

      {/* Earnings breakdown modal */}
      <Modal visible={showEarningsDetail} transparent animationType="slide" onRequestClose={() => setShowEarningsDetail(false)}>
        <View style={s.modalBg}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Earnings Breakdown</Text>
              <TouchableOpacity onPress={() => setShowEarningsDetail(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={s.earningsRow}><Text style={s.earningsLabel}>Gross Revenue</Text><Text style={s.earningsValue}>R{earnings.total.toLocaleString('en-ZA')}</Text></View>
            <View style={s.earningsRow}><Text style={s.earningsLabel}>Platform Fee (30%)</Text><Text style={[s.earningsValue, { color: '#ef4444' }]}>-R{earnings.commission.toLocaleString('en-ZA')}</Text></View>
            <View style={[s.earningsRow, s.earningsTotalRow]}><Text style={s.earningsTotalLabel}>Your Net Pay</Text><Text style={s.earningsTotalValue}>R{earnings.net.toLocaleString('en-ZA')}</Text></View>
            <Text style={s.earningsMeta}>{earnings.count} completed session{earnings.count !== 1 ? 's' : ''} | Payout within 5 business days</Text>
            <TouchableOpacity style={s.earningsCTA} onPress={() => { setShowEarningsDetail(false); navigation.navigate('EarningsDashboard'); }}>
              <Text style={s.earningsCTAText}>Full Earnings Report</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <NewMessageModal
        visible={showNewMessage}
        onClose={() => setShowNewMessage(false)}
        profiles={state.profiles ?? []}
        currentUserId={currentUser?.id}
        onSelectUser={async (user) => {
          const convo = await startConversationWithUser(user.id, user.full_name ?? 'User');
          setShowNewMessage(false);
          navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
        }}
      />
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a14' },
  container: { padding: 16, paddingBottom: 120 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  newMsgBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  eyebrow: { color: '#8b5cf6', fontWeight: '800', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 2 },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  onlineLabel: { fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  statsRow: { flexDirection: 'row', marginBottom: 16, gap: 12 },
  statCard: { flex: 1, backgroundColor: '#1e293b', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: '#334155' },
  statLabel: { color: '#64748b', fontWeight: '700', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 26, fontWeight: '900', color: '#fff', marginTop: 4 },
  statMeta: { color: '#475569', marginTop: 4, fontSize: 12 },
  priorityCard: { backgroundColor: '#1e293b', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: '#334155', marginBottom: 14 },
  priorityRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  priorityPill: { flex: 1, backgroundColor: '#0f172a', borderRadius: 12, borderWidth: 1, borderColor: '#334155', paddingVertical: 10, alignItems: 'center' },
  priorityValue: { color: '#fff', fontSize: 17, fontWeight: '900' },
  priorityLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '800', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  howCard: { marginBottom: 14, backgroundColor: '#111827', borderColor: '#334155' },
  howTitle: { color: '#cbd5e1' },
  howItem: { color: '#94a3b8' },
  card: { backgroundColor: '#1e293b', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: '#334155', marginBottom: 14 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#fff' },
  cardMeta: { color: '#8b5cf6', fontWeight: '700', fontSize: 11, textTransform: 'uppercase' },
  viewAll: { color: '#8b5cf6', fontWeight: '700' },
  requestCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  requestInfo: { flex: 1 },
  requestPackage: { color: '#fff', fontWeight: '800', fontSize: 15 },
  requestDate: { color: '#64748b', fontSize: 13, marginTop: 2 },
  requestAmount: { color: '#10b981', fontWeight: '700', fontSize: 14, marginTop: 2 },
  requestActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  acceptBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#10b981', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, gap: 4 },
  acceptBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  declineBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  chatBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(139,92,246,0.1)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(139,92,246,0.3)' },
  chatLabelBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(139,92,246,0.1)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.3)' },
  chatLabelText: { color: '#8b5cf6', fontWeight: '800', fontSize: 12 },
  activeCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  activeActions: { flexDirection: 'row', gap: 8 },
  completeBtn: { backgroundColor: '#3b82f6', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  completeBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  mapCard: { backgroundColor: '#1e293b', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#334155', marginBottom: 14 },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, padding: 10, backgroundColor: 'rgba(139,92,246,0.1)', borderRadius: 10, alignSelf: 'flex-start' },
  navBtnText: { color: '#8b5cf6', fontWeight: '700' },
  toolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  toolBtn: { width: '30%', alignItems: 'center', minHeight: 74, justifyContent: 'center' },
  toolIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  toolLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  modelPill: { alignItems: 'center', marginRight: 14, width: 72 },
  modelAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#334155', borderWidth: 2, borderColor: '#8b5cf6', marginBottom: 6 },
  modelName: { color: '#fff', fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 4 },
  modelChatBtn: { backgroundColor: 'rgba(139,92,246,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  modelChatBtnText: { color: '#8b5cf6', fontSize: 10, fontWeight: '700' },
  settingsCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#334155', gap: 12 },
  settingsText: { flex: 1, color: '#94a3b8', fontWeight: '600' },
  // Modal
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1e293b', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  earningsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#334155' },
  earningsLabel: { color: '#94a3b8', fontSize: 15 },
  earningsValue: { color: '#fff', fontWeight: '700', fontSize: 15 },
  earningsTotalRow: { borderBottomWidth: 0, marginTop: 8, paddingTop: 16 },
  earningsTotalLabel: { color: '#fff', fontWeight: '900', fontSize: 18 },
  earningsTotalValue: { color: '#10b981', fontWeight: '900', fontSize: 22 },
  earningsMeta: { color: '#475569', fontSize: 13, marginTop: 12, textAlign: 'center' },
  earningsCTA: { backgroundColor: '#8b5cf6', borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 16 },
  earningsCTAText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});

export default PhotographerDashboardScreen;
