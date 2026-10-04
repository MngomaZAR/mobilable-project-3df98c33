import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../store/ThemeContext';
import { backendDb, hasBackendProvider } from '../services/backendGateway';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { StackNavigationProp } from '@react-navigation/stack';
import { respondToDispatch } from '../services/dispatchService';
import { useServiceAccess } from '../hooks/useServiceAccess';

type Navigation = StackNavigationProp<RootStackParamList, 'Notifications'>;

interface NotificationItem {
  id: string;
  event_type: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
  category?: 'booking' | 'social' | 'message' | 'earnings';
  action_type?: string;
  action_payload?: Record<string, unknown>;
}

const payloadId = (item: NotificationItem, ...keys: string[]) => {
  for (const key of keys) {
    const value = item.action_payload?.[key];
    if (typeof value === 'string' && value.trim() && value.length <= 120) return value;
  }
  return null;
};

const NotificationsScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { state } = useAppData();
  const access = useServiceAccess();
  const userId = state.currentUser?.id;
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const acting = useRef(false);
  const generation = useRef(0);
  const fetching = useRef(false);
  const [activeTab, setActiveTab] = useState<'all' | 'booking' | 'social' | 'earnings'>('all');

  const fetchNotifications = useCallback(async (silent = false) => {
    if (!hasBackendProvider || !userId || fetching.current) return;
    const version = generation.current;
    fetching.current = true;
    if (!silent) setLoading(true);
    try {
      const { data, error: failure } = await backendDb
        .from('notification_events')
        .select('id, event_type, title, body, status, created_at, category, action_type, action_payload')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (failure) throw new Error(failure.message || 'Notifications could not be loaded.');
      if (version !== generation.current) return;
      setNotifications((data ?? []) as NotificationItem[]);
      setOwnerId(userId);
      setError(null);
    } catch (failure) {
      if (version === generation.current) setError(failure instanceof Error ? failure.message : 'Notifications could not be loaded.');
    } finally {
      if (version === generation.current) { fetching.current = false; setLoading(false); }
    }
  }, [userId]);

  const filteredNotifications = useMemo(() => {
    const owned = ownerId === userId ? notifications : [];
    if (activeTab === 'all') return owned;
    return owned.filter(n => n.category === activeTab);
  }, [notifications, activeTab, ownerId, userId]);

  const handleAction = async (item: NotificationItem, action: string) => {
    if (acting.current || !userId || ownerId !== userId) return;
    acting.current = true;
    setBusyId(item.id);
    const version = generation.current;
    try {
      if (action === 'accept' || action === 'decline') {
        if (action === 'accept' && !access.allowed('dispatch')) throw new Error('Instant booking acceptance is unavailable for this account.');
        const dispatchRequestId = payloadId(item, 'dispatch_request_id', 'dispatchRequestId');
        const offerId = payloadId(item, 'offer_id', 'offerId');
        if (!dispatchRequestId || !offerId) throw new Error('Dispatch details are unavailable for this request.');
        await respondToDispatch({
          dispatch_request_id: dispatchRequestId,
          offer_id: offerId,
          response: action === 'accept' ? 'accept' : 'decline',
          idempotency_key: `${item.id}-${action}`,
        });
        if (version !== generation.current) return;
        Alert.alert(action === 'accept' ? 'Booking accepted' : 'Offer declined', action === 'accept' ? 'Awaiting client payment.' : 'You have declined this offer.');
      } else if (action === 'view') {
        const conversationId = payloadId(item, 'conversation_id', 'chatId');
        const bookingId = payloadId(item, 'booking_id', 'bookingId');
        if (conversationId) navigation.navigate('ChatThread', { conversationId });
        else if (bookingId) navigation.navigate('BookingDetail', { bookingId });
        else throw new Error('This notification has no available destination.');
      }
      const status = action !== 'view' || item.status === 'dismissed' ? 'dismissed' : 'read';
      const { error: failure } = await backendDb.from('notification_events')
        .update({ status, read_at: new Date().toISOString() }).eq('id', item.id).eq('user_id', userId);
      if (failure) throw new Error('The action succeeded, but marking this notification read failed. Refresh to confirm.');
      if (version === generation.current) setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, status } : n));
    } catch (failure) {
      if (version === generation.current) Alert.alert('Notification action', failure instanceof Error ? failure.message : 'Could not complete this action.');
    } finally {
      if (version === generation.current) { acting.current = false; setBusyId(null); }
    }
  };

  useEffect(() => {
    generation.current++;
    fetching.current = false;
    acting.current = false;
    setNotifications([]);
    setOwnerId(null);
    setBusyId(null);
    setError(null);
    setLoading(false);
    void fetchNotifications();
    const timer = setInterval(() => void fetchNotifications(true), 15000);
    return () => { generation.current++; clearInterval(timer); };
  }, [fetchNotifications]);

  const iconFor = (type: string) => {
    if (type.includes('booking')) return 'calendar';
    if (type.includes('message')) return 'chatbubble';
    if (type.includes('payment')) return 'card';
    if (type.includes('review')) return 'star';
    return 'notifications';
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Notifications</Text>
      </View>

      <View style={[styles.tabBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {['all', 'booking', 'social', 'earnings'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              { borderBottomColor: 'transparent' },
              activeTab === tab && { borderBottomColor: colors.accent, backgroundColor: colors.bg },
            ]}
            onPress={() => setActiveTab(tab as any)}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.text : colors.textMuted }]}>
              {tab.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && <View style={styles.errorRow}>
        <Text accessibilityRole="alert" style={{ color: colors.destructive, flex: 1 }}>{error}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry notifications" onPress={() => void fetchNotifications()} disabled={loading}>
          <Ionicons name="refresh-outline" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>}

      <FlatList
        data={filteredNotifications}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void fetchNotifications()} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.iconBox, { backgroundColor: colors.accent + '22' }]}>
              <Ionicons name={iconFor(item.event_type) as any} size={20} color={colors.accent} />
            </View>
            <View style={styles.cardBody}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.title} disabled={busyId !== null}
                onPress={() => void handleAction(item, 'view')} style={styles.notificationLink}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
                {['queued', 'unread'].includes(item.status) && <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />}
              </View>
              <Text style={[styles.cardBody2, { color: colors.textSecondary }]}>{item.body}</Text>
              </TouchableOpacity>
              
              {item.event_type === 'booking_dispatch_offered' && item.status !== 'dismissed' && (
                <View style={styles.actionRow}>
                  <TouchableOpacity 
                    accessibilityRole="button" accessibilityLabel="Accept instant booking offer"
                    disabled={busyId !== null || !access.allowed('dispatch')}
                    style={[styles.actionBtn, { backgroundColor: colors.accent }]} 
                    onPress={() => handleAction(item, 'accept')}
                  >
                    <Text style={styles.actionBtnText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    accessibilityRole="button" accessibilityLabel="Decline instant booking offer" disabled={busyId !== null}
                    style={[styles.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} 
                    onPress={() => handleAction(item, 'decline')}
                  >
                    <Text style={[styles.actionBtnText, { color: colors.text }]}>Decline</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={[styles.cardTime, { color: colors.textMuted }]}>
                {new Date(item.created_at).toLocaleString()}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !loading && !error ? (
            <View style={styles.empty}>
              <Ionicons name="notifications-off-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyTxt, { color: colors.textMuted }]}>No notifications yet</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  tabBar: {
    flexDirection: 'row',
    padding: 6,
    gap: 6,
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  errorRow: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    borderRadius: 6,
    alignItems: 'center',
  },
  tabText: { fontSize: 11, fontWeight: '800', letterSpacing: 0 },
  list: { padding: 16, gap: 10 },
  card: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
    alignItems: 'flex-start',
    overflow: 'hidden',
  },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  notificationLink: { minHeight: 44 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  cardTitle: { fontWeight: '700', fontSize: 15 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  cardBody2: { fontSize: 13, lineHeight: 18 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, alignItems: 'center', justifyContent: 'center', minWidth: 80, minHeight: 44 },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cardTime: { fontSize: 11, marginTop: 8 },
  empty: { alignItems: 'center', marginTop: 80, gap: 12, paddingHorizontal: 24 },
  emptyTxt: { fontSize: 16 },
});

export default NotificationsScreen;
