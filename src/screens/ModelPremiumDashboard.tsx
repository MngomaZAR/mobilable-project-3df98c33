import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Alert, RefreshControl, ScrollView, StyleSheet, Text,
  TouchableOpacity, View, Image, Dimensions, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
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

const { width } = Dimensions.get('window');
type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const ModelPremiumDashboard: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { currentUser } = useAuth();
  const { bookings, refreshBookings, acceptBooking, declineBooking } = useBooking();
  const { state, refresh } = useAppData();
  const { startConversationWithUser } = useMessaging();
  const [showPremiumBox, setShowPremiumBox] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tierPayoutRate, setTierPayoutRate] = useState(0.70);
  const [showSubscribers, setShowSubscribers] = useState(false);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [tierMap, setTierMap] = useState<Record<string, { name: string; price?: number }>>({});
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await supabase
          .from('subscription_tiers')
          .select('id, name, price');
        const map: Record<string, { name: string; price?: number }> = {};
        (data ?? []).forEach((tier: any) => {
          map[tier.id] = { name: tier.name ?? 'Tier', price: tier.price };
        });
        setTierMap(map);
      } catch { /* silent */ }
    };
    load();
  }, []);

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
      net: bookingEarnings + tipEarnings + (subEarnings * tierPayoutRate),
      activeSubscribers: activeSubs,
      tipsTotal: tipEarnings,
      bookingCount: bookings.filter(b => b.status === 'completed').length,
    };
  }, [bookings, state.earnings, state.subscriptions, tierPayoutRate]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), refreshBookings()]);
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

  const pendingBookings = useMemo(() => bookings.filter(b => b.status === 'pending'), [bookings]);

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
      Alert.alert('✅ Booking Accepted', 'The client has been notified. Navigate to their location.');
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

  return (
    <SafeAreaView style={s.safeArea}>
      <ScrollView
        contentContainerStyle={s.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ec4899" />}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.greeting}>Elite Creator Dashboard</Text>
            <Text style={s.title}>
              Welcome, {currentUser?.full_name?.split(' ')[0] ?? 'Creator'} ✨
            </Text>
          </View>
          <View style={s.headerActions}>
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
  // Modal
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1e293b', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  subRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#334155', gap: 12 },
  subAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#334155' },
  subName: { color: '#fff', fontWeight: '700' },
  subTier: { color: '#94a3b8', fontSize: 12, textTransform: 'capitalize' },
  subExpiry: { color: '#64748b', fontSize: 12 },
});

export default ModelPremiumDashboard;
