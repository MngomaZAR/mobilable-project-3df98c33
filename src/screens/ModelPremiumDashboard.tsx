import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Alert, RefreshControl, ScrollView, StyleSheet, Text,
  TouchableOpacity, View, Image, Dimensions, Modal, TextInput, Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../store/AuthContext';
import { useBooking } from '../store/BookingContext';
import { useAppData } from '../store/AppDataContext';
import { useMessaging } from '../store/MessagingContext';
import { RootStackParamList } from '../navigation/types';
import { supabase } from '../config/supabaseClient';
import CreatePremiumBox from './CreatePremiumBox';
import { NewMessageModal } from '../components/NewMessageModal';
import { sendTip } from '../services/monetisationService';
import HowItWorksCard from '../components/HowItWorksCard';

const { width } = Dimensions.get('window');
type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const ModelPremiumDashboard: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { currentUser: authUser } = useAuth();
  const { bookings, refreshBookings, acceptBooking, declineBooking } = useBooking();
  const { state, fetchEarnings, fetchSubscriptions, fetchCredits } = useAppData();
  const { startConversationWithUser } = useMessaging();
  const insets = useSafeAreaInsets();
  const [showPremiumBox, setShowPremiumBox] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tierPayoutRate, setTierPayoutRate] = useState(0.70);
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
  const [isOnline, setIsOnline] = useState(true);
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
    if (!currentUser?.id) return;
    try {
      const { data } = await supabase
        .from('subscription_tiers')
        .select('id, name, price, perks, is_active, color, max_subscribers, description')
        .eq('creator_id', currentUser.id)
        .order('created_at', { ascending: true });
      setTiers(data ?? []);
    } catch {
      setTiers([]);
    }
  }, [currentUser?.id]);

  const loadTipGoal = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      const { data } = await supabase
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
  }, [currentUser?.id]);

  useEffect(() => {
    loadTiers();
    loadTipGoal();
  }, [loadTiers, loadTipGoal]);

  useEffect(() => {
    const profile = state.profiles.find((p: any) => p.id === currentUser?.id) as any;
    if (profile?.availability_status) {
      setIsOnline(profile.availability_status === 'online');
    }
  }, [currentUser?.id, state.profiles]);

  const fetchSubscribers = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      const { data } = await supabase
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
    const bookingEarnings = bookings
      .filter(b => b.status === 'completed' || b.status === 'accepted')
      .reduce((s, b) => s + (b.payout_amount || 0), 0);
    const activeSubs = (state.subscriptions ?? []).filter((s: any) => s.status === 'active').length;

    return {
      net: bookingEarnings + tipEarnings + subEarnings,
      activeSubscribers: activeSubs,
      tipsTotal: tipEarnings,
      bookingCount: bookings.filter(b => b.status === 'completed').length,
    };
  }, [bookings, state.earnings, state.subscriptions, tierPayoutRate]);

  const onRefresh = async () => {
    setRefreshing(true);
    const userId = currentUser?.id;
    await Promise.all([
      refreshBookings(),
      loadTiers(),
      loadTipGoal(),
      userId ? fetchEarnings(userId) : Promise.resolve(),
      userId ? fetchSubscriptions(userId) : Promise.resolve(),
      userId ? fetchCredits(userId) : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  const handleGoLive = () => {
    if (!currentUser?.id) {
      Alert.alert('Profile Required', 'Complete your profile to go live.');
      return;
    }
    // Navigate to paid video call as creator
    navigation.navigate('PaidVideoCall', { creatorId: currentUser.id, role: 'creator' });
  };

  const handleOnlineToggle = async (nextValue: boolean) => {
    if (!kycApproved) {
      Alert.alert('Verification required', 'Complete KYC to go online and accept jobs.');
      return;
    }
    setIsOnline(nextValue);
    try {
      await supabase
        .from('profiles')
        .update({ availability_status: nextValue ? 'online' : 'offline' })
        .eq('id', currentUser?.id);
      await supabase
        .from('models')
        .update({ is_online: nextValue })
        .eq('id', currentUser?.id);
      refresh();
    } catch {
      // soft-fail
    }
  };

  const pendingBookings = useMemo(() => bookings.filter(b => b.status === 'pending'), [bookings]);
  const goalCurrentAmount = Number(tipGoal?.current_amount ?? 0);
  const goalTargetAmount = Number(tipGoal?.target_amount ?? 0);
  const goalPercent = goalTargetAmount > 0 ? Math.min(100, Math.round((goalCurrentAmount / goalTargetAmount) * 100)) : 0;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const run = async () => {
        if (!active) return;
        const userId = currentUser?.id;
        await Promise.all([
          refreshBookings(),
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
    }, [currentUser?.id, fetchCredits, fetchEarnings, fetchSubscriptions, loadTipGoal, loadTiers, refreshBookings]),
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
        const { error } = await supabase
          .from('tip_goals')
          .update({ title, target_amount: targetAmount })
          .eq('id', tipGoal.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
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
        const { error } = await supabase
          .from('subscription_tiers')
          .update({ name, price, perks })
          .eq('id', editingTier.id)
          .eq('creator_id', currentUser.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
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
            <Text style={s.greeting}>Elite Creator Dashboard</Text>
            <Text style={s.title}>
              Welcome, {currentUser?.full_name?.split(' ')[0] ?? 'Creator'}
            </Text>
          </View>
          <View style={s.headerActions}>
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
            <TouchableOpacity style={s.iconBtn} onPress={() => setShowNewMessage(true)}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('AccountConfig')}>
              <Image
                source={{ uri: currentUser?.avatar_url ?? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200' }}
                style={s.avatar}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Hero earnings card */}
        <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('EarningsDashboard')}>
          <LinearGradient colors={['#7c3aed', '#db2777']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.heroLabel}>Total Earnings</Text>
              <Text style={s.heroValue}>R{earnings.net.toLocaleString('en-ZA')}</Text>
              <View style={s.heroStats}>
                <TouchableOpacity style={s.hStat} onPress={() => { fetchSubscribers(); setShowSubscribers(true); }}>
                  <Text style={s.hStatVal}>{earnings.activeSubscribers}</Text>
                  <Text style={s.hStatLabel}>Subscribers</Text>
                </TouchableOpacity>
                <View style={s.hStat}>
                  <Text style={s.hStatVal}>R{earnings.tipsTotal.toLocaleString('en-ZA')}</Text>
                  <Text style={s.hStatLabel}>Tips</Text>
                </View>
                <View style={s.hStat}>
                  <Text style={s.hStatVal}>{earnings.bookingCount}</Text>
                  <Text style={s.hStatLabel}>Sessions</Text>
                </View>
              </View>
            </View>
            <Ionicons name="arrow-forward-circle" size={36} color="rgba(255,255,255,0.5)" />
          </LinearGradient>
        </TouchableOpacity>

        <View style={s.priorityCard}>
          <Text style={s.sectionTitle}>Today Priorities</Text>
          <View style={s.priorityRow}>
            <View style={s.priorityPill}>
              <Text style={s.priorityValue}>{pendingBookings.length}</Text>
              <Text style={s.priorityLabel}>Pending</Text>
            </View>
            <View style={s.priorityPill}>
              <Text style={s.priorityValue}>{earnings.activeSubscribers}</Text>
              <Text style={s.priorityLabel}>Subscribers</Text>
            </View>
            <View style={s.priorityPill}>
              <Text style={s.priorityValue}>R{earnings.tipsTotal.toLocaleString('en-ZA')}</Text>
              <Text style={s.priorityLabel}>Tips</Text>
            </View>
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
                    {booking.booking_date
                      ? new Date(booking.booking_date).toLocaleDateString('en-ZA', { dateStyle: 'medium' })
                      : 'Date TBD'}
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
            { icon: 'videocam', label: 'Go Live', color: '#db2777', bg: '#fdf2f8', onPress: handleGoLive },
            { icon: 'add-circle', label: 'Post', color: '#7c3aed', bg: '#f5f3ff', onPress: () => setShowPremiumBox(true) },
            { icon: 'people', label: 'Subscribers', color: '#059669', bg: '#ecfdf5', onPress: () => currentUser?.id && navigation.navigate('CreatorSubscriptions', { creatorId: currentUser.id }) },
            { icon: 'chatbubbles', label: 'Messages', color: '#ea580c', bg: '#fff7ed', onPress: () => navigation.navigate('Root', { screen: 'Chat' }) },
            { icon: 'images', label: 'Media', color: '#0284c7', bg: '#eff6ff', onPress: () => currentUser?.id && navigation.navigate('MediaLibrary', { creatorId: currentUser.id }) },
            { icon: 'calendar', label: 'Bookings', color: '#d97706', bg: '#fffbeb', onPress: () => navigation.navigate('Root', { screen: 'Bookings' }) },
            { icon: 'diamond', label: 'Upgrade', color: '#f59e0b', bg: '#fefce8', onPress: () => navigation.navigate('Support') },
            { icon: 'settings', label: 'Profile', color: '#6366f1', bg: '#eef2ff', onPress: () => navigation.navigate('AccountConfig') },
          ].map(a => (
            <TouchableOpacity key={a.label} style={s.actionBtn} onPress={a.onPress}>
              <View style={[s.actionIcon, { backgroundColor: a.bg }]}>
                <Ionicons name={a.icon as any} size={24} color={a.color} />
              </View>
              <Text style={s.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tip Goal Bar */}
        <View style={s.section}>
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
        </View>

        {/* Subscription Tiers */}
        <View style={s.section}>
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
        </View>

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
                    {booking.booking_date
                      ? new Date(booking.booking_date).toLocaleDateString('en-ZA', { dateStyle: 'medium' })
                      : 'Date TBD'}
                  </Text>
                </View>
                <View style={[s.statusBadge, {
                  backgroundColor: booking.status === 'completed' ? '#10b98120' :
                    booking.status === 'accepted' ? '#3b82f620' : '#f59e0b20',
                }]}>
                  <Text style={[s.statusText, {
                    color: booking.status === 'completed' ? '#10b981' :
                      booking.status === 'accepted' ? '#3b82f6' : '#f59e0b',
                  }]}>{booking.status}</Text>
                </View>
                {booking.status === 'accepted' && (
                  <TouchableOpacity
                    style={s.joinBtn}
                    onPress={() => currentUser?.id && navigation.navigate('PaidVideoCall', { creatorId: currentUser.id, role: 'creator' })}
                  >
                    <Text style={s.joinBtnText}>Join</Text>
                  </TouchableOpacity>
                )}
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

        {/* Fan Leaderboard */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Top Fans (This Month)</Text>
            <Ionicons name="trophy-outline" size={18} color="#f59e0b" />
          </View>
          <View style={s.leaderboardCard}>
            {[
              { name: 'John Doe', amount: 2400, rank: 1, avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100' },
              { name: 'Sarah W.', amount: 1850, rank: 2, avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100' },
              { name: 'Mike R.', amount: 900, rank: 3, avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100' },
            ].map((fan, i) => (
              <View key={fan.name} style={[s.fanRow, i === 2 && { borderBottomWidth: 0 }]}>
                <Text style={s.fanRank}>{fan.rank}</Text>
                <Image source={{ uri: fan.avatar }} style={s.fanAvatar} />
                <Text style={s.fanName}>{fan.name}</Text>
                <Text style={s.fanAmount}>R{fan.amount.toLocaleString('en-ZA')}</Text>
              </View>
            ))}
          </View>
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
                  <Image source={{ uri: p.avatar_url ?? 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=200' }} style={s.talentAvatar} />
                  <Text style={s.talentName} numberOfLines={1}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Upgrade banner */}
        <TouchableOpacity style={s.upgradeBanner} onPress={() => navigation.navigate('Support')}>
          <LinearGradient colors={['#1e1b4b', '#312e81']} style={s.upgradeBannerInner}>
            <Ionicons name="diamond" size={28} color="#fbbf24" />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={s.upgradeTitle}>Upgrade to Elite Gold</Text>
              <Text style={s.upgradeSub}>85% payout rate + verified badge + priority matching</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#fbbf24" />
          </LinearGradient>
        </TouchableOpacity>

        <HowItWorksCard
          title="How Earnings Work"
          persistKey="model-dashboard-earnings-how"
          items={[
            'Accepted bookings move to active sessions and are eligible for payout after completion.',
            'Declined requests close that offer and notify clients to continue matching.',
            'Tips, subscriptions, and PPV sales are recorded in your earnings ledger separately.',
            'Payout methods require verification before withdrawals are released.',
          ]}
          containerStyle={s.howCard}
          titleStyle={s.howTitle}
          itemStyle={s.howItem}
        />

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
              subscribers.map((sub: any) => (
                <View key={sub.id} style={s.subRow}>
                  <Image
                    source={{ uri: (sub.profiles as any)?.avatar_url ?? 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100' }}
                    style={s.subAvatar}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={s.subName}>{(sub.profiles as any)?.full_name ?? 'Subscriber'}</Text>
                  <Text style={s.subTier}>{tierMap[sub.tier_id]?.name ?? 'Tier'} tier</Text>
                </View>
                  <Text style={s.subExpiry}>
                    Renews {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('en-ZA') : 'soon'}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a14' },
  container: { padding: 20, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  onlineRow: { alignItems: 'center', justifyContent: 'center' },
  onlineLabel: { fontWeight: '800', fontSize: 10, marginBottom: 4, letterSpacing: 0.8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  greeting: { color: '#ec4899', fontWeight: '800', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 2 },
  avatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: '#ec4899' },
  heroCard: { borderRadius: 24, padding: 24, flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  heroLabel: { color: 'rgba(255,255,255,0.75)', fontWeight: '700', fontSize: 13 },
  heroValue: { color: '#fff', fontSize: 36, fontWeight: '900', marginTop: 4 },
  heroStats: { flexDirection: 'row', marginTop: 16, gap: 20 },
  hStat: { alignItems: 'flex-start' },
  hStatVal: { color: '#fff', fontWeight: '800', fontSize: 16 },
  hStatLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
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
  actionBtn: { width: (width - 40 - 36) / 4, alignItems: 'center' },
  actionIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  actionLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  section: { marginBottom: 24 },
  priorityCard: { backgroundColor: '#1e293b', borderRadius: 16, borderWidth: 1, borderColor: '#334155', padding: 14, marginBottom: 14 },
  priorityRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  priorityPill: { flex: 1, backgroundColor: '#0f172a', borderRadius: 12, borderWidth: 1, borderColor: '#334155', paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  priorityValue: { color: '#fff', fontWeight: '900', fontSize: 15 },
  priorityLabel: { color: '#94a3b8', marginTop: 2, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
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
  tierCard: { backgroundColor: '#1e293b', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#334155', width: 220, marginRight: 12 },
  tierHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tierName: { color: '#a855f7', fontWeight: '800', fontSize: 15, textTransform: 'uppercase' },
  tierPrice: { color: '#fff', fontWeight: '900', fontSize: 24, marginBottom: 12 },
  tierPerks: { gap: 6 },
  tierPerk: { color: '#cbd5e1', fontSize: 13 },
  leaderboardCard: { backgroundColor: '#1e293b', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#334155' },
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
  modalContent: { backgroundColor: '#1e293b', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '80%' },
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
