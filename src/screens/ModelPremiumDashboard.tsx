import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert, RefreshControl, ScrollView, StyleSheet, Text,
  TouchableOpacity, View, Image, Modal, TextInput, Switch,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../store/AuthContext';
import { useBooking } from '../store/BookingContext';
import { useAppData } from '../store/AppDataContext';
import { useMessaging } from '../store/MessagingContext';
import { RootStackParamList } from '../navigation/types';
import { backendDb } from '../services/backendGateway';
import CreatePremiumBox from './CreatePremiumBox';
import { NewMessageModal } from '../components/NewMessageModal';
import { PLACEHOLDER_AVATAR } from '../utils/constants';
import { environment } from '../config/environment';
import { areDigitalPurchasesAllowed } from '../config/commercePolicy';
import { useTheme } from '../store/ThemeContext';
import { formatBookingStart } from '../utils/bookingTime';
import { summarizeRecordedEarnings } from '../utils/earningsSummary';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;
type ProviderAvailability = { is_online: boolean; availability_status: string; kyc_status: string | null };
type SubscriberProfile = { avatar_url?: string | null; full_name?: string | null } | null | undefined;

const ModelPremiumDashboard: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const digitalEnabled = environment.backendProvider !== 'api' && areDigitalPurchasesAllowed();
  const { width } = useWindowDimensions();
  const { currentUser: authUser } = useAuth();
  const { bookings, refreshBookings, acceptBooking, declineBooking } = useBooking();
  const { state, fetchEarnings, fetchSubscriptions, fetchCredits, fetchBookings } = useAppData();
  const { startConversationWithUser } = useMessaging();
  const insets = useSafeAreaInsets();
  const [showPremiumBox, setShowPremiumBox] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showSubscribers, setShowSubscribers] = useState(false);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [tiers, setTiers] = useState<any[]>([]);
  const [tipGoal, setTipGoal] = useState<any | null>(null);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [goalTitleInput, setGoalTitleInput] = useState('');
  const [goalTargetInput, setGoalTargetInput] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);
  const [tierModalVisible, setTierModalVisible] = useState(false);
  const [editingTier, setEditingTier] = useState<any | null>(null);
  const [tierNameInput, setTierNameInput] = useState('');
  const [tierPriceInput, setTierPriceInput] = useState('');
  const [tierPerksInput, setTierPerksInput] = useState('');
  const [savingTier, setSavingTier] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [availabilityReady, setAvailabilityReady] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityKycApproved, setAvailabilityKycApproved] = useState(false);
  const availabilityWriting = useRef(false);
  const availabilityRequest = useRef(0);
  const currentUser = authUser ?? state.currentUser;
  const kycApproved = (currentUser?.kyc_status ?? state.currentUser?.kyc_status) === 'approved';
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const tierMap = useMemo(() => {
    const map: Record<string, { name: string; price?: number }> = {};
    (tiers ?? []).forEach((tier: any) => {
      map[tier.id] = { name: tier.name ?? 'Tier', price: tier.price };
    });
    return map;
  }, [tiers]);

  const loadTiers = useCallback(async () => {
    if (!currentUser?.id || !digitalEnabled) return;
    try {
      const { data } = await backendDb
        .from('subscription_tiers')
        .select('id, name, price, perks, is_active, color, max_subscribers, description')
        .eq('creator_id', currentUser.id)
        .order('created_at', { ascending: true });
      setTiers(data ?? []);
    } catch {
      setTiers([]);
    }
  }, [currentUser?.id, digitalEnabled]);

  const loadTipGoal = useCallback(async () => {
    if (!currentUser?.id || !digitalEnabled) return;
    try {
      const { data } = await backendDb
        .from('tip_goals')
        .select('*')
        .eq('creator_id', currentUser.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setTipGoal(data ?? null);
    } catch {
      setTipGoal(null);
    }
  }, [currentUser?.id, digitalEnabled]);

  useEffect(() => {
    loadTiers();
    loadTipGoal();
  }, [loadTiers, loadTipGoal]);

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
          backendDb.from('models').select('is_online').eq('id', currentUser.id).maybeSingle(),
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
  }, [currentUser?.id]);

  useEffect(() => {
    availabilityRequest.current += 1;
    availabilityWriting.current = false;
    setIsOnline(false);
    setAvailabilityReady(false);
    setAvailabilityLoading(false);
    setAvailabilityBusy(false);
    setAvailabilityKycApproved(false);
    return () => { availabilityRequest.current += 1; };
  }, [currentUser?.id]);

  const fetchSubscribers = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      const { data } = await backendDb
        .from('subscriptions')
        .select('id, subscriber_id, status, current_period_end, tier_id, profiles:subscriber_id(full_name, avatar_url)')
        .eq('creator_id', currentUser.id)
        .eq('status', 'active');
      setSubscribers(data ?? []);
    } catch { /* silent */ }
  }, [currentUser?.id]);

  const earnings = useMemo(() => {
    const earningRows = state.earnings ?? [];
    const tipEarnings = earningRows
      .filter((e: any) => e.source_type === 'tip')
      .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    const subEarnings = earningRows
      .filter((e: any) => e.source_type === 'subscription')
      .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    const activeSubs = (state.subscriptions ?? []).filter((s: any) => s.status === 'active').length;

    return {
      net: summarizeRecordedEarnings(earningRows, bookings).net,
      activeSubscribers: activeSubs,
      tipsTotal: tipEarnings,
      bookingCount: bookings.filter(b => b.status === 'completed' || b.status === 'paid_out').length,
    };
  }, [bookings, state.earnings, state.subscriptions]);

  const onRefresh = async () => {
    setRefreshing(true);
    const userId = currentUser?.id;
    try {
      await Promise.allSettled([
        loadAvailability(),
        refreshBookings(),
        fetchBookings(userId),
        loadTiers(),
        loadTipGoal(),
        userId ? fetchEarnings(userId) : Promise.resolve(),
        userId ? fetchSubscriptions(userId) : Promise.resolve(),
        userId ? fetchCredits(userId) : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

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
        const provider = await backendDb.from('models').update({ is_online: nextValue }).eq('id', userId).select('id').single();
        if (provider.error) throw provider.error;
        if (!provider.data) throw new Error('Your provider profile could not be updated.');
      }
      if (request !== availabilityRequest.current) return;
      setIsOnline(nextValue);
      await Promise.allSettled([
        refreshBookings(),
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

  const pendingBookings = useMemo(() => bookings.filter(b => b.status === 'pending'), [bookings]);
  const goalCurrentAmount = Number(tipGoal?.current_amount ?? 0);
  const goalTargetAmount = Number(tipGoal?.target_amount ?? 0);
  const goalPercent = goalTargetAmount > 0 ? Math.min(100, Math.round((goalCurrentAmount / goalTargetAmount) * 100)) : 0;
  const actionItemWidth = width > 900 ? '23%' : width > 640 ? '31%' : '48%';

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const run = async () => {
        if (!active) return;
        const userId = currentUser?.id;
        await Promise.allSettled([
          loadAvailability(),
          refreshBookings(),
          fetchBookings(userId),
          loadTiers(),
          loadTipGoal(),
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
    }, [currentUser?.id, fetchBookings, fetchCredits, fetchEarnings, fetchSubscriptions, loadAvailability, loadTipGoal, loadTiers, refreshBookings]),
  );

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
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          try {
            await declineBooking(bookingId);
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? 'Could not decline booking.');
          }
        },
      },
    ]);
  };

  const parseMoneyInput = (value: string) => Number(String(value).replace(/[^0-9.]/g, ''));

  const openGoalModal = () => {
    setGoalTitleInput(tipGoal?.title ?? '');
    setGoalTargetInput(tipGoal?.target_amount ? String(tipGoal.target_amount) : '');
    setGoalModalVisible(true);
  };

  const saveGoal = async () => {
    if (!currentUser?.id) {
      Alert.alert('Profile Required', 'Sign in to manage your tip goal.');
      return;
    }
    const title = goalTitleInput.trim();
    const targetAmount = parseMoneyInput(goalTargetInput);
    if (!title) {
      Alert.alert('Goal title required', 'Add a short name for your tip goal.');
      return;
    }
    if (!targetAmount || targetAmount <= 0) {
      Alert.alert('Target amount required', 'Enter a valid target amount.');
      return;
    }
    setSavingGoal(true);
    try {
      if (tipGoal?.id) {
        const { error } = await backendDb
          .from('tip_goals')
          .update({ title, target_amount: targetAmount })
          .eq('id', tipGoal.id);
        if (error) throw error;
      } else {
        const { error } = await backendDb
          .from('tip_goals')
          .insert({ creator_id: currentUser.id, title, target_amount: targetAmount, is_active: true });
        if (error) throw error;
      }
      await loadTipGoal();
      setGoalModalVisible(false);
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? 'Could not update your tip goal.');
    } finally {
      setSavingGoal(false);
    }
  };

  const openTierModal = (tier?: any) => {
    setEditingTier(tier ?? null);
    setTierNameInput(tier?.name ?? '');
    setTierPriceInput(tier?.price != null ? String(tier.price) : '');
    setTierPerksInput(Array.isArray(tier?.perks) ? tier.perks.join('\n') : '');
    setTierModalVisible(true);
  };

  const parsePerksInput = (value: string) =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

  const saveTier = async () => {
    if (!currentUser?.id) {
      Alert.alert('Profile Required', 'Sign in to manage your tiers.');
      return;
    }
    const name = tierNameInput.trim();
    const price = parseMoneyInput(tierPriceInput);
    if (!name) {
      Alert.alert('Tier name required', 'Give this tier a name.');
      return;
    }
    if (!price || price <= 0) {
      Alert.alert('Tier price required', 'Enter a valid monthly price.');
      return;
    }
    setSavingTier(true);
    try {
      const perks = parsePerksInput(tierPerksInput);
      if (editingTier?.id) {
        const { error } = await backendDb
          .from('subscription_tiers')
          .update({ name, price, perks })
          .eq('id', editingTier.id)
          .eq('creator_id', currentUser.id);
        if (error) throw error;
      } else {
        const { error } = await backendDb
          .from('subscription_tiers')
          .insert({ creator_id: currentUser.id, name, price, perks, is_active: true });
        if (error) throw error;
      }
      await loadTiers();
      setTierModalVisible(false);
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? 'Could not update this tier.');
    } finally {
      setSavingTier(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={s.safeArea}>
      <ScrollView
        contentContainerStyle={[s.container, { paddingTop: Math.max(8, insets.top + 2), paddingBottom: Math.max(100, insets.bottom + 88) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ec4899" />}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.greeting}>Model Dashboard</Text>
            <Text style={s.title}>
              Welcome, {currentUser?.full_name?.split(' ')[0] ?? 'Creator'}
            </Text>
          </View>
          <View style={s.headerActions}>
            <View style={s.onlineRow}>
              <Text style={[s.onlineLabel, { color: availabilityReady && isOnline ? '#10b981' : '#64748b' }]}>
                {availabilityBusy ? 'SAVING' : availabilityLoading ? 'CHECKING' : !availabilityReady ? 'UNKNOWN' : isOnline ? 'AVAILABLE' : 'OFFLINE'}
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
            <TouchableOpacity style={s.iconBtn} onPress={() => setShowNewMessage(true)}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('AccountConfig')}>
              <Image
                source={{ uri: currentUser?.avatar_url ?? PLACEHOLDER_AVATAR }}
                style={s.avatar}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Hero earnings card */}
        <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('EarningsDashboard')}>
          <View style={s.heroCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.heroLabel}>Recorded Earnings</Text>
              <Text style={s.heroValue}>R{earnings.net.toLocaleString('en-ZA')}</Text>
              <View style={s.heroStats}>
                {digitalEnabled && <TouchableOpacity style={s.hStat} onPress={() => { fetchSubscribers(); setShowSubscribers(true); }}>
                  <Text style={s.hStatVal}>{earnings.activeSubscribers}</Text>
                  <Text style={s.hStatLabel}>Subscribers</Text>
                </TouchableOpacity>}
                {digitalEnabled && <View style={s.hStat}>
                  <Text style={s.hStatVal}>R{earnings.tipsTotal.toLocaleString('en-ZA')}</Text>
                  <Text style={s.hStatLabel}>Tips</Text>
                </View>}
                <View style={s.hStat}>
                  <Text style={s.hStatVal}>{earnings.bookingCount}</Text>
                  <Text style={s.hStatLabel}>Sessions</Text>
                </View>
              </View>
            </View>
            <Ionicons name="arrow-forward-circle" size={30} color={colors.accent} />
          </View>
        </TouchableOpacity>

        <View style={s.priorityCard}>
          <Text style={s.sectionTitle}>Today Priorities</Text>
          <View style={s.priorityRow}>
            <View style={s.priorityPill}>
              <Text style={s.priorityValue}>{pendingBookings.length}</Text>
              <Text style={s.priorityLabel}>Pending</Text>
            </View>
            {digitalEnabled && <View style={s.priorityPill}>
              <Text style={s.priorityValue}>{earnings.activeSubscribers}</Text>
              <Text style={s.priorityLabel}>Subscribers</Text>
            </View>}
            {digitalEnabled && <View style={s.priorityPill}>
              <Text style={s.priorityValue}>R{earnings.tipsTotal.toLocaleString('en-ZA')}</Text>
              <Text style={s.priorityLabel}>Tips</Text>
            </View>}
          </View>
        </View>

        {/* Pending booking alerts */}
        {pendingBookings.length > 0 && (
          <TouchableOpacity style={s.alertCard} onPress={() => navigation.navigate('Root', { screen: 'Bookings' })}>
            <View style={s.alertDot} />
            <Text style={s.alertText}>
              {pendingBookings.length} new booking request{pendingBookings.length > 1 ? 's' : ''} waiting
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#f59e0b" />
          </TouchableOpacity>
        )}

        {pendingBookings.length > 0 && (
          <View style={s.pendingWrap}>
            {pendingBookings.slice(0, 3).map(booking => (
              <View key={booking.id} style={s.pendingCard}>
                <View style={{ flex: 1 }}>
                  <Text style={s.pendingTitle}>{booking.package_type ?? 'Booking Request'}</Text>
                  <Text style={s.pendingMeta}>
                    {formatBookingStart(booking)}
                  </Text>
                  <Text style={s.pendingMeta}>R{(booking.total_amount ?? 0).toLocaleString('en-ZA')}</Text>
                </View>
                <View style={s.pendingActions}>
                  <TouchableOpacity
                    style={s.pendingAccept}
                    onPress={() => handleAcceptBooking(booking.id)}
                    disabled={acceptingId === booking.id}
                  >
                    <Text style={s.pendingAcceptText}>{acceptingId === booking.id ? '...' : 'Accept'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.pendingDecline} onPress={() => handleDeclineBooking(booking.id)}>
                    <Ionicons name="close" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Quick actions */}
        <View style={s.actionsGrid}>
          {[
            { icon: 'eye', label: 'Availability', color: '#db2777', bg: '#fdf2f8', onPress: () => navigation.navigate('Availability') },
            { icon: 'add-circle', label: 'Post', color: '#7c3aed', bg: '#f5f3ff', onPress: () => digitalEnabled ? setShowPremiumBox(true) : navigation.navigate('CreatePost') },
            { icon: 'people', label: 'Subscribers', color: '#059669', bg: '#ecfdf5', onPress: () => currentUser?.id && navigation.navigate('CreatorSubscriptions', { creatorId: currentUser.id }) },
            { icon: 'chatbubbles', label: 'Messages', color: '#ea580c', bg: '#fff7ed', onPress: () => navigation.navigate('Root', { screen: 'Chat' }) },
            { icon: 'images', label: 'Media', color: '#0284c7', bg: '#eff6ff', onPress: () => currentUser?.id && navigation.navigate('MediaLibrary', { creatorId: currentUser.id }) },
            { icon: 'calendar', label: 'Bookings', color: '#d97706', bg: '#fffbeb', onPress: () => navigation.navigate('Root', { screen: 'Bookings' }) },
            { icon: 'list', label: 'Services', color: '#ec4899', bg: '#fdf2f8', onPress: () => navigation.navigate('ModelServices') },
            { icon: kycApproved ? 'shield-checkmark' : 'shield-outline', label: kycApproved ? 'Verified' : 'Verify ID', color: kycApproved ? '#22c55e' : '#f59e0b', bg: '#fffbeb', onPress: () => navigation.navigate('KYC') },
            { icon: 'settings', label: 'Profile', color: '#6366f1', bg: '#eef2ff', onPress: () => navigation.navigate('AccountConfig') },
          ].filter(a => digitalEnabled || a.label !== 'Subscribers').map(a => (
            <TouchableOpacity key={a.label} style={[s.actionBtn, { width: actionItemWidth }]} onPress={a.onPress}>
              <View style={[s.actionIcon, { backgroundColor: a.bg }]}>
                <Ionicons name={a.icon as any} size={24} color={a.color} />
              </View>
              <Text style={s.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tip Goal Bar */}
        {digitalEnabled && <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Tip Goal</Text>
            <TouchableOpacity onPress={openGoalModal}>
              <Text style={s.viewAll}>{tipGoal ? 'Edit' : 'Set goal'}</Text>
            </TouchableOpacity>
          </View>
          {tipGoal ? (
            <View style={s.goalCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={s.goalTitle}>{tipGoal.title}</Text>
                <Text style={s.goalAmount}>
                  R{goalCurrentAmount.toLocaleString('en-ZA')} / R{goalTargetAmount.toLocaleString('en-ZA')}
                </Text>
              </View>
              <View style={s.goalTrack}>
                <View style={[s.goalFill, { width: `${goalPercent}%` }]} />
              </View>
              <Text style={s.goalSub}>{goalPercent}% completed</Text>
            </View>
          ) : (
            <View style={s.goalCard}>
              <Text style={s.goalTitle}>No active goal yet</Text>
              <Text style={s.goalSub}>Set a tip goal so fans know what you're working toward.</Text>
              <TouchableOpacity style={s.goalCta} onPress={openGoalModal}>
                <Text style={s.goalCtaText}>Create goal</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>}

        {/* Subscription Tiers */}
        {digitalEnabled && <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Subscription Tiers</Text>
            <TouchableOpacity onPress={() => openTierModal()}>
              <Text style={s.viewAll}>+ Add New</Text>
            </TouchableOpacity>
          </View>
          {tiers.length === 0 ? (
            <Text style={s.empty}>You haven't set up any subscription tiers yet.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingBottom: 8 }}>
              {tiers.map((tier) => (
                <View key={tier.id} style={s.tierCard}>
                   <View style={s.tierHeader}>
                     <Text style={s.tierName}>{tier.name}</Text>
                     <TouchableOpacity onPress={() => openTierModal(tier)}>
                       <Ionicons name="ellipsis-horizontal" size={18} color="#94a3b8" />
                     </TouchableOpacity>
                   </View>
                   <Text style={s.tierPrice}>R{Number(tier.price ?? 0).toLocaleString('en-ZA')} <Text style={{ fontSize: 13, color: '#64748b' }}>/ mo</Text></Text>
                   <View style={s.tierPerks}>
                     {(Array.isArray(tier.perks) && tier.perks.length > 0) ? (
                       tier.perks.map((perk: string, idx: number) => (
                         <Text key={`${tier.id}-perk-${idx}`} style={s.tierPerk}>- {perk}</Text>
                       ))
                     ) : (
                       <Text style={s.tierPerk}>- No perks listed yet</Text>
                     )}
                   </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>}

        {/* Recent bookings */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Recent Bookings</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Root', { screen: 'Bookings' })}>
              <Text style={s.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          {bookings.length === 0 ? (
            <Text style={s.empty}>No bookings yet. Share your profile to get started!</Text>
          ) : (
            bookings.slice(0, 3).map(booking => (
              <TouchableOpacity
                key={booking.id}
                style={s.bookingCard}
                onPress={() => navigation.navigate('BookingDetail', { bookingId: booking.id })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.bookingTitle}>{booking.package_type ?? 'Booking'}</Text>
                  <Text style={s.bookingDate}>
                    {formatBookingStart(booking)}
                  </Text>
                </View>
                <View style={[s.statusBadge, {
                  backgroundColor: booking.status === 'completed' ? '#10b98120' :
                    booking.status === 'accepted' ? '#3b82f620' : '#f59e0b20',
                }]}>
                  <Text style={[s.statusText, {
                    color: booking.status === 'completed' ? '#10b981' :
                      booking.status === 'accepted' ? '#3b82f6' : '#f59e0b',
                  }]}>{booking.status === 'accepted' && booking.payment_status !== 'paid' ? 'Awaiting Payment' : booking.status}</Text>
                </View>
                <TouchableOpacity
                  style={s.chatBtn}
                  onPress={() => openChatWithClient(booking.client_id, 'Client')}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color="#fff" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Top photographers to collaborate */}
        {(state.photographers ?? []).length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Top Photographers</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Root', { screen: 'Map' })}>
                <Text style={s.viewAll}>Book Now</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(state.photographers ?? []).slice(0, 8).map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={s.talentPill}
                  onPress={() => navigation.navigate('UserProfile', { userId: p.id })}
                >
                  <Image source={{ uri: p.avatar_url ?? PLACEHOLDER_AVATAR }} style={s.talentAvatar} />
                  <Text style={s.talentName} numberOfLines={1}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Payout Settings */}
        <TouchableOpacity 
          style={s.payoutBtn} 
          onPress={() => navigation.navigate('PayoutMethods')}
        >
          <Ionicons name="card-outline" size={20} color="#fff" />
          <Text style={s.payoutBtnText}>Manage Payout Methods</Text>
        </TouchableOpacity>
      </ScrollView>

      <CreatePremiumBox
        visible={showPremiumBox}
        onClose={() => setShowPremiumBox(false)}
        onSuccess={() => setShowPremiumBox(false)}
      />

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

      {/* Tip goal modal */}
      <Modal visible={goalModalVisible} transparent animationType="slide" onRequestClose={() => setGoalModalVisible(false)}>
        <View style={s.modalBg}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Tip Goal</Text>
              <TouchableOpacity onPress={() => setGoalModalVisible(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={s.modalLabel}>Goal title</Text>
            <TextInput
              style={s.modalInput}
              placeholder="New Camera Kit"
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={goalTitleInput}
              onChangeText={setGoalTitleInput}
            />
            <Text style={[s.modalLabel, { marginTop: 12 }]}>Target amount (ZAR)</Text>
            <TextInput
              style={s.modalInput}
              placeholder="5000"
              placeholderTextColor="rgba(255,255,255,0.45)"
              keyboardType="numeric"
              value={goalTargetInput}
              onChangeText={setGoalTargetInput}
            />
            <TouchableOpacity style={s.modalPrimaryBtn} onPress={saveGoal} disabled={savingGoal}>
              <Text style={s.modalPrimaryText}>{savingGoal ? 'Saving...' : 'Save Goal'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Tier modal */}
      <Modal visible={tierModalVisible} transparent animationType="slide" onRequestClose={() => setTierModalVisible(false)}>
        <View style={s.modalBg}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{editingTier ? 'Edit Tier' : 'Create Tier'}</Text>
              <TouchableOpacity onPress={() => setTierModalVisible(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={s.modalLabel}>Tier name</Text>
            <TextInput
              style={s.modalInput}
              placeholder="Gold VIP"
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={tierNameInput}
              onChangeText={setTierNameInput}
            />
            <Text style={[s.modalLabel, { marginTop: 12 }]}>Price per month (ZAR)</Text>
            <TextInput
              style={s.modalInput}
              placeholder="249"
              placeholderTextColor="rgba(255,255,255,0.45)"
              keyboardType="numeric"
              value={tierPriceInput}
              onChangeText={setTierPriceInput}
            />
            <Text style={[s.modalLabel, { marginTop: 12 }]}>Perks (one per line)</Text>
            <TextInput
              style={[s.modalInput, s.modalTextArea]}
              placeholder="Exclusive feed access"
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={tierPerksInput}
              onChangeText={setTierPerksInput}
              multiline
            />
            <TouchableOpacity style={s.modalPrimaryBtn} onPress={saveTier} disabled={savingTier}>
              <Text style={s.modalPrimaryText}>{savingTier ? 'Saving...' : 'Save Tier'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Subscribers modal */}
      <Modal visible={showSubscribers} transparent animationType="slide" onRequestClose={() => setShowSubscribers(false)}>
        <View style={s.modalBg}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Active Subscribers ({subscribers.length})</Text>
              <TouchableOpacity onPress={() => setShowSubscribers(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            {subscribers.length === 0 ? (
              <Text style={s.empty}>No active subscribers yet.</Text>
            ) : (
              subscribers.map((sub: any) => {
                const subscriberProfile = sub.profiles as SubscriberProfile;
                return (
                <View key={sub.id} style={s.subRow}>
                  <Image
                    source={{ uri: subscriberProfile?.avatar_url ?? PLACEHOLDER_AVATAR }}
                    style={s.subAvatar}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={s.subName}>{subscriberProfile?.full_name ?? 'Subscriber'}</Text>
                  <Text style={s.subTier}>{tierMap[sub.tier_id]?.name ?? 'Tier'} tier</Text>
                </View>
                  <Text style={s.subExpiry}>
                    Renews {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('en-ZA') : 'soon'}
                  </Text>
                </View>
              )})
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 20, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  onlineRow: { alignItems: 'center', justifyContent: 'center' },
  onlineLabel: { fontWeight: '800', fontSize: 10, marginBottom: 4, letterSpacing: 0 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  greeting: { color: colors.textMuted, fontWeight: '700', fontSize: 12, letterSpacing: 0 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 2 },
  avatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: '#ec4899' },
  heroCard: {
    borderRadius: 0,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#fff',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  heroLabel: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  heroValue: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 4 },
  heroStats: { flexDirection: 'row', marginTop: 16, gap: 20 },
  hStat: { alignItems: 'flex-start' },
  hStatVal: { color: colors.text, fontWeight: '800', fontSize: 16 },
  hStatLabel: { color: colors.textMuted, fontSize: 12 },
  alertCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1a0a', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#f59e0b40', marginBottom: 16, gap: 10 },
  alertDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f59e0b' },
  alertText: { flex: 1, color: '#f59e0b', fontWeight: '700' },
  pendingWrap: { marginBottom: 18 },
  pendingCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#334155', marginBottom: 10, gap: 12 },
  pendingTitle: { color: '#fff', fontWeight: '800', fontSize: 14 },
  pendingMeta: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  pendingActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingAccept: { backgroundColor: '#10b981', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  pendingAcceptText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  pendingDecline: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  actionBtn: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  actionIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  actionLabel: { color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  section: { marginBottom: 24 },
  priorityCard: {
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    marginBottom: 14,
    overflow: 'hidden',
  },
  priorityRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  priorityPill: { flex: 1, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  priorityValue: { color: colors.text, fontWeight: '800', fontSize: 15 },
  priorityLabel: { color: colors.textMuted, marginTop: 2, fontSize: 11, fontWeight: '700', letterSpacing: 0 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  viewAll: { color: '#ec4899', fontWeight: '700' },
  bookingCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155', gap: 10 },
  bookingTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  bookingDate: { color: '#64748b', fontSize: 13, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontWeight: '800', fontSize: 12, textTransform: 'capitalize' },
  joinBtn: { backgroundColor: '#8b5cf6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  joinBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  chatBtn: { backgroundColor: '#0ea5e9', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginLeft: 8 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 10, lineHeight: 22 },
  talentPill: { alignItems: 'center', marginRight: 14, width: 70 },
  talentAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#334155', borderWidth: 2, borderColor: '#ec4899', marginBottom: 6 },
  talentName: { color: '#fff', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  upgradeBanner: { borderRadius: 20, overflow: 'hidden', marginBottom: 10 },
  upgradeBannerInner: { flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 20 },
  upgradeTitle: { color: '#fbbf24', fontWeight: '900', fontSize: 15 },
  upgradeSub: { color: '#a5b4fc', fontSize: 12, marginTop: 2 },
  goalCard: { backgroundColor: '#1e293b', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#334155' },
  goalTitle: { color: '#fff', fontWeight: '800', fontSize: 15 },
  goalAmount: { color: '#ec4899', fontWeight: '800', fontSize: 14 },
  goalTrack: { height: 8, backgroundColor: '#0f172a', borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  goalFill: { height: '100%', backgroundColor: '#ec4899', borderRadius: 4 },
  goalSub: { color: '#94a3b8', fontSize: 12 },
  goalCta: { marginTop: 12, alignSelf: 'flex-start', backgroundColor: '#ec4899', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  goalCtaText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  tierCard: {
    backgroundColor: 'rgba(30,41,59,0.86)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    width: 220,
    marginRight: 12,
    overflow: 'hidden',
  },
  tierHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tierName: { color: '#a855f7', fontWeight: '800', fontSize: 15, textTransform: 'uppercase' },
  tierPrice: { color: '#fff', fontWeight: '900', fontSize: 24, marginBottom: 12 },
  tierPerks: { gap: 6 },
  tierPerk: { color: '#cbd5e1', fontSize: 13 },
  leaderboardCard: { backgroundColor: 'rgba(30,41,59,0.86)', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(148,163,184,0.18)' },
  fanRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#334155', gap: 12 },
  fanRank: { color: '#94a3b8', fontWeight: '800', width: 20 },
  fanAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#334155' },
  fanName: { color: '#fff', fontWeight: '600', flex: 1 },
  fanAmount: { color: '#10b981', fontWeight: '800' },
  payoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#334155', padding: 16, borderRadius: 16, marginTop: 12, gap: 10, borderWidth: 1, borderColor: '#475569' },
  payoutBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  howCard: { marginTop: 14, backgroundColor: '#111827', borderColor: '#334155' },
  howTitle: { color: '#cbd5e1' },
  howItem: { color: '#94a3b8' },
  // Modal
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: 'rgba(30,41,59,0.96)', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '80%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  modalLabel: { color: '#94a3b8', fontWeight: '700', fontSize: 12 },
  modalInput: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#334155',
    fontWeight: '700',
    marginTop: 8,
  },
  modalTextArea: { minHeight: 100, textAlignVertical: 'top' },
  modalPrimaryBtn: {
    marginTop: 18,
    backgroundColor: '#ec4899',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  subRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#334155', gap: 12 },
  subAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#334155' },
  subName: { color: '#fff', fontWeight: '700' },
  subTier: { color: '#94a3b8', fontSize: 12, textTransform: 'capitalize' },
  subExpiry: { color: '#64748b', fontSize: 12 },
});

export default ModelPremiumDashboard;
