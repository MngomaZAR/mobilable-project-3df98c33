import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { backendDb } from '../services/backendGateway';
import { invokeBackendFunction } from '../config/backendFunctions';
import { DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates } from '../utils/geo';
import { NewMessageModal } from '../components/NewMessageModal';
import HowItWorksCard from '../components/HowItWorksCard';
import { PLACEHOLDER_AVATAR } from '../utils/constants';
import { isModelUser } from '../utils/userRole';
import { summarizeRecordedEarnings } from '../utils/earningsSummary';
import { environment } from '../config/environment';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;
type ProviderAvailability = { is_online: boolean; availability_status: string; kyc_status: string | null };

const PhotographerDashboardScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { currentUser: authUser } = useAuth();
  const { bookings, acceptBooking, declineBooking, refreshBookings, updateBookingStatus } = useBooking();
  const { startConversationWithUser } = useMessaging();
  const { state, updatePhotographerLocation, fetchEarnings, fetchSubscriptions, fetchCredits, fetchBookings } = useAppData();
  const currentUser = authUser ?? state.currentUser;
  const isModelAccount = isModelUser(currentUser);
  const insets = useSafeAreaInsets();
  const [isOnline, setIsOnline] = useState(false);
  const [availabilityReady, setAvailabilityReady] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityKycApproved, setAvailabilityKycApproved] = useState(false);
  const availabilityWriting = useRef(false);
  const availabilityRequest = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [showEarningsDetail, setShowEarningsDetail] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);

  const activeBooking = useMemo(
    () => bookings.find(b => b.status === 'accepted' && b.payment_status === 'paid') ?? bookings.find(b => b.status === 'pending'),
    [bookings]
  );
  const pendingBookings = useMemo(() => bookings.filter(b => b.status === 'pending'), [bookings]);
  const acceptedBookings = useMemo(() => bookings.filter(b => b.status === 'accepted'), [bookings]);
  const completedBookings = useMemo(() => bookings.filter(b => b.status === 'completed' || b.status === 'paid_out'), [bookings]);
  const kycApproved = (currentUser?.kyc_status ?? state.currentUser?.kyc_status) === 'approved';

  const loadAvailability = useCallback(async () => {
    if (availabilityWriting.current || !currentUser?.id) return;
    const request = ++availabilityRequest.current;
    setAvailabilityLoading(true);
    try {
      let result: ProviderAvailability;
      if (environment.backendProvider === 'api') {
        const token = await getApiAccessToken();
        if (request !== availabilityRequest.current) return;
        if (!token) throw new Error('Please sign in again.');
        result = await apiClient.get<ProviderAvailability>('/providers/me/availability', { token });
        if (typeof result.is_online !== 'boolean' || result.availability_status !== (result.is_online ? 'online' : 'offline') ||
            (result.is_online && result.kyc_status !== 'approved')) throw new Error('Invalid availability response.');
      } else {
        const [profile, provider] = await Promise.all([
          backendDb.from('profiles').select('availability_status,kyc_status').eq('id', currentUser.id).maybeSingle(),
          backendDb.from(isModelAccount ? 'models' : 'photographers').select('is_online').eq('id', currentUser.id).maybeSingle(),
        ]);
        if (profile.error) throw profile.error;
        if (provider.error) throw provider.error;
        if (!profile.data || !provider.data || (provider.data.is_online != null && typeof provider.data.is_online !== 'boolean')) throw new Error('Provider availability is not configured.');
        result = {
          is_online: profile.data.kyc_status === 'approved' && profile.data.availability_status === 'online' && provider.data.is_online === true,
          availability_status: profile.data.availability_status,
          kyc_status: profile.data.kyc_status,
        };
      }
      if (request === availabilityRequest.current) {
        setIsOnline(result.is_online);
        setAvailabilityKycApproved(result.kyc_status === 'approved');
        setAvailabilityReady(true);
      }
    } catch {
      if (request === availabilityRequest.current) {
        setIsOnline(false);
        setAvailabilityReady(false);
      }
    } finally {
      if (request === availabilityRequest.current) setAvailabilityLoading(false);
    }
  }, [currentUser?.id, isModelAccount]);

  useEffect(() => {
    availabilityRequest.current += 1;
    availabilityWriting.current = false;
    setIsOnline(false);
    setAvailabilityReady(false);
    setAvailabilityLoading(false);
    setAvailabilityBusy(false);
    setAvailabilityKycApproved(false);
    return () => { availabilityRequest.current += 1; };
  }, [currentUser?.id, isModelAccount]);

  const earnings = useMemo(() => {
    return summarizeRecordedEarnings(state.earnings ?? [], bookings);
  }, [bookings, state.earnings]);

  const talentProfile = useMemo(() => {
    if (isModelAccount) {
      return state.models.find((m) => m.id === currentUser?.id);
    }
    return state.photographers.find((p) => p.id === currentUser?.id);
  }, [currentUser, isModelAccount, state.photographers, state.models]);

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

  // Acceptance reserves the booking; tracking starts only after confirmed payment.
  useEffect(() => {
    if (!currentUser || !isOnline || !availabilityReady || activeBooking?.status !== 'accepted' || activeBooking.payment_status !== 'paid') return;
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
          try { await updatePhotographerLocation(latitude, longitude, undefined, coords.accuracy ?? undefined); } catch { /* soft fail */ }
        }
      );
    };

    startTracking();
    return () => { mounted = false; subscription?.remove(); };
  }, [activeBooking?.status, activeBooking?.payment_status, availabilityReady, currentUser, isOnline, updatePhotographerLocation]);

  const handleOnlineToggle = async (nextValue: boolean) => {
    const userId = currentUser?.id;
    if (!userId || availabilityWriting.current || availabilityLoading || !availabilityReady) return;
    if (nextValue && !availabilityKycApproved) {
      Alert.alert('Verification required', 'Complete KYC to go online and accept jobs.');
      return;
    }
    const previous = isOnline;
    const request = ++availabilityRequest.current;
    availabilityWriting.current = true;
    setAvailabilityBusy(true);
    try {
      if (environment.backendProvider === 'api') {
        const token = await getApiAccessToken();
        if (request !== availabilityRequest.current) return;
        if (!token) throw new Error('Please sign in again.');
        const result = await apiClient.post<ProviderAvailability>('/providers/me/availability', { is_online: nextValue }, { token });
        if (result.is_online !== nextValue || result.availability_status !== (nextValue ? 'online' : 'offline') ||
            (nextValue && result.kyc_status !== 'approved')) throw new Error('Availability could not be confirmed.');
        if (request !== availabilityRequest.current) return;
        setAvailabilityKycApproved(result.kyc_status === 'approved');
      } else {
        const profile = await backendDb.from('profiles').update({ availability_status: nextValue ? 'online' : 'offline' }).eq('id', userId).select('id').single();
        if (profile.error) throw profile.error;
        if (!profile.data) throw new Error('Your profile could not be updated.');
        const provider = await backendDb.from(isModelAccount ? 'models' : 'photographers').update({ is_online: nextValue }).eq('id', userId).select('id').single();
        if (provider.error) throw provider.error;
        if (!provider.data) throw new Error('Your provider profile could not be updated.');
      }
      if (request !== availabilityRequest.current) return;
      setIsOnline(nextValue);
      await Promise.allSettled([
        fetchBookings(userId),
        userId ? fetchEarnings(userId) : Promise.resolve(),
        userId ? fetchSubscriptions(userId) : Promise.resolve(),
        userId ? fetchCredits(userId) : Promise.resolve(),
      ]);
    } catch (error) {
      if (request === availabilityRequest.current) {
        setIsOnline(previous);
        setAvailabilityReady(false);
        const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Could not update availability.';
        Alert.alert('Availability Update Failed', `${message} Refresh to confirm your status before retrying.`);
      }
    } finally {
      if (request === availabilityRequest.current) {
        availabilityWriting.current = false;
        setAvailabilityBusy(false);
      }
    }
  };

  const handleAcceptBooking = async (bookingId: string) => {
    setAcceptingId(bookingId);
    try {
      await acceptBooking(bookingId);
      Alert.alert('Booking Accepted', 'Waiting for the client to pay before the session can begin.');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not accept booking.');
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDeclineBooking = async (bookingId: string) => {
    Alert.alert('Decline Booking', 'Decline this booking request?', [
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
    if (bookings.find(booking => booking.id === bookingId)?.payment_status !== 'paid') {
      Alert.alert('Payment Required', 'Waiting for the client to pay before the session can begin.');
      return;
    }
    Alert.alert('Mark Complete', 'Confirm this paid session is done?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Complete', onPress: async () => {
          try {
            await updateBookingStatus(bookingId, 'completed');

            // Release escrow to providers
            const { error: escrowError } = await invokeBackendFunction('escrow-release', {
              booking_id: bookingId,
            });
            if (escrowError) {
              console.error('Escrow release failed:', escrowError);
              // Non-blocking - escrow can be retried manually from admin dashboard
            }

            await refreshBookings();
            Alert.alert('Session Complete', 'The session has been marked complete.');
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
        loadAvailability(),
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
          loadAvailability(),
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
    }, [currentUser?.id, fetchBookings, fetchCredits, fetchEarnings, fetchSubscriptions, loadAvailability, refreshBookings]),
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
            <Text style={s.eyebrow}>{isModelAccount ? 'Model Mode' : 'Photographer Mode'}</Text>
            <Text style={s.title} numberOfLines={1}>
              {currentUser?.full_name?.split(' ')[0] ?? (isModelAccount ? 'Model' : 'Photographer')}'s Dashboard
            </Text>
          </View>
          <TouchableOpacity style={s.newMsgBtn} onPress={() => setShowNewMessage(true)}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#fff" />
          </TouchableOpacity>
          <View style={s.onlineRow}>
            <Text style={[s.onlineLabel, { color: availabilityReady && isOnline ? '#10b981' : '#64748b' }]}>
              {availabilityBusy ? 'SAVING' : availabilityLoading ? 'CHECKING' : !availabilityReady ? 'UNKNOWN' : isOnline ? 'LIVE' : 'OFFLINE'}
            </Text>
            <Switch
              value={availabilityReady && isOnline}
              accessibilityLabel="Provider online availability"
              onValueChange={handleOnlineToggle}
              disabled={availabilityBusy || availabilityLoading || !availabilityReady || (!isOnline && !availabilityKycApproved)}
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
            <Text style={s.statMeta}>{acceptedBookings.length} accepted | {completedBookings.length} done</Text>
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
              <Text style={s.priorityLabel}>Accepted</Text>
            </View>
            <View style={s.priorityPill}>
              <Text style={[s.priorityValue, { color: availabilityReady && isOnline ? '#10b981' : '#64748b' }]}>{!availabilityReady ? '--' : isOnline ? 'ON' : 'OFF'}</Text>
              <Text style={s.priorityLabel}>Availability</Text>
            </View>
          </View>
        </View>

        <HowItWorksCard
          title="How Request Actions Work"
          persistKey="photographer-dashboard-actions-how"
          items={[
            'Accept reserves the session; it begins after the client pays.',
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
            <Text style={s.cardTitle}>Accepted Bookings</Text>
            {acceptedBookings.map(booking => (
              <View key={booking.id} style={s.activeCard}>
                <View style={{ flex: 1 }}>
                  <Text style={s.requestPackage}>{booking.package_type ?? 'Session'}</Text>
                  <Text style={s.requestDate}>
                    {booking.booking_date
                      ? new Date(booking.booking_date).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
                      : 'Date TBD'}
                  </Text>
                  {booking.payment_status !== 'paid' && <Text style={s.requestDate}>Awaiting Payment</Text>}
                </View>
                <View style={s.activeActions}>
                  <TouchableOpacity
                    style={s.completeBtn}
                    onPress={() => handleCompleteBooking(booking.id)}
                    disabled={booking.payment_status !== 'paid'}
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
        {activeBooking?.status === 'accepted' && activeBooking.payment_status === 'paid' && <View style={s.mapCard}>
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
        </View>}

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
              ...(isModelAccount
                ? [{ icon: 'list', label: 'Services', color: '#ec4899', action: () => navigation.navigate('ModelServices') }]
                : [{ icon: 'camera', label: 'Equipment', color: '#c9a44a', action: () => navigation.navigate('EquipmentSetup') }]),
              { icon: kycApproved ? 'shield-checkmark' : 'shield-outline', label: kycApproved ? 'Verified' : 'Verify ID', color: kycApproved ? '#22c55e' : '#f59e0b', action: () => navigation.navigate('KYC') },
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
                  <Image source={{ uri: model.avatar_url ?? PLACEHOLDER_AVATAR }} style={s.modelAvatar} />
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
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(30,41,59,0.86)',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    overflow: 'hidden',
  },
  statLabel: { color: '#64748b', fontWeight: '700', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 26, fontWeight: '900', color: '#fff', marginTop: 4 },
  statMeta: { color: '#475569', marginTop: 4, fontSize: 12 },
  priorityCard: {
    backgroundColor: 'rgba(30,41,59,0.86)',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    marginBottom: 14,
    overflow: 'hidden',
  },
  priorityRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  priorityPill: { flex: 1, backgroundColor: '#0f172a', borderRadius: 12, borderWidth: 1, borderColor: '#334155', paddingVertical: 10, alignItems: 'center' },
  priorityValue: { color: '#fff', fontSize: 17, fontWeight: '900' },
  priorityLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '800', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  howCard: { marginBottom: 14, backgroundColor: '#111827', borderColor: '#334155' },
  howTitle: { color: '#cbd5e1' },
  howItem: { color: '#94a3b8' },
  card: {
    backgroundColor: 'rgba(30,41,59,0.86)',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    marginBottom: 14,
    overflow: 'hidden',
  },
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
  mapCard: {
    backgroundColor: 'rgba(30,41,59,0.86)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    marginBottom: 14,
    overflow: 'hidden',
  },
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
  settingsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,41,59,0.86)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    gap: 12,
    overflow: 'hidden',
  },
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
