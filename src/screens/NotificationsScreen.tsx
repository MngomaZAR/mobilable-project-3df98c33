import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../store/ThemeContext';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { StackNavigationProp } from '@react-navigation/stack';
import { respondToDispatch } from '../services/dispatchService';
import HowItWorksCard from '../components/HowItWorksCard';

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
  action_payload?: any;
}

const NotificationsScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { state } = useAppData();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'booking' | 'social' | 'earnings'>('all');

  const fetchNotifications = useCallback(async () => {
    if (!hasSupabase || !state.currentUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_events')
        .select('id, event_type, title, body, status, created_at, category, action_type, action_payload')
        .eq('user_id', state.currentUser.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error) {
        setNotifications((data ?? []) as NotificationItem[]);
        const queuedIds = (data ?? [])
          .filter((n: any) => n.status === 'queued')
          .map((n: any) => n.id);
        if (queuedIds.length > 0) {
          await supabase
            .from('notification_events')
            .update({ status: 'sent' })
            .in('id', queuedIds);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [state.currentUser]);

  const filteredNotifications = useMemo(() => {
    if (activeTab === 'all') return notifications;
    return notifications.filter(n => n.category === activeTab);
  }, [notifications, activeTab]);

  const handleAction = async (item: NotificationItem, action: string) => {
    if ((action === 'accept' || action === 'decline') && item.event_type.includes('booking')) {
      const dispatchRequestId = item.action_payload?.dispatchRequestId || item.action_payload?.dispatch_request_id;
      const offerId = item.action_payload?.offerId || item.action_payload?.offer_id;
      if (dispatchRequestId) {
        try {
          await respondToDispatch({
            dispatch_request_id: dispatchRequestId,
            offer_id: offerId,
            response: action === 'accept' ? 'accept' : 'decline',
            idempotency_key: `${item.id}-${action}`,
          });
          Alert.alert(action === 'accept' ? 'Booking Accepted' : 'Booking Declined', action === 'accept' ? 'You have accepted this booking request.' : 'You have declined this booking request.');
        } catch (e: any) {
          Alert.alert('Dispatch Error', e?.message || 'Could not process request. Try again.');
          return;
        }
      } else {
        Alert.alert('Missing details', 'Dispatch details are unavailable for this request.');
        return;
      }
    } else if (action === 'view') {
       if (item.action_type === 'chat') {
          navigation.navigate('ChatThread', { conversationId: item.action_payload?.chatId });
       } else if (item.action_type === 'booking') {
          navigation.navigate('BookingDetail', { bookingId: item.action_payload?.bookingId });
       }
    }
    // Mark as read/dismissed
    setNotifications(prev => prev.filter(n => n.id !== item.id));
  };

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

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

      <View style={styles.tabBar}>
        {['all', 'booking', 'social', 'earnings'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && { borderBottomColor: colors.accent }]}
            onPress={() => setActiveTab(tab as any)}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.text : colors.textMuted }]}>
              {tab.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.howWrap}>
        <HowItWorksCard
          title="How Notification Actions Work"
          items={[
            'Accept or Decline sends an auditable dispatch response with idempotency protection.',
            'If dispatch details are missing, no action is executed and status stays unchanged.',
            'Viewed actions open chat or booking detail so you can complete next steps safely.',
            'Resolved cards are removed from this list after local acknowledgement.',
          ]}
        />
      </View>

      <FlatList
        data={filteredNotifications}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchNotifications} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => handleAction(item, 'view')}
          >
            <View style={[styles.iconBox, { backgroundColor: colors.accent + '22' }]}>
              <Ionicons name={iconFor(item.event_type) as any} size={20} color={colors.accent} />
            </View>
            <View style={styles.cardBody}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
                {item.status === 'queued' && <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />}
              </View>
              <Text style={[styles.cardBody2, { color: colors.textSecondary }]}>{item.body}</Text>
              
              {item.event_type.includes('booking_request') && (
                <View style={styles.actionRow}>
                  <TouchableOpacity 
                    style={[styles.actionBtn, { backgroundColor: colors.accent }]} 
                    onPress={() => handleAction(item, 'accept')}
                  >
                    <Text style={styles.actionBtnText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
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
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading ? (
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
  tabBar: { flexDirection: 'row', paddingHorizontal: 16, gap: 20, marginTop: 8 },
  howWrap: { paddingHorizontal: 16, marginTop: 8 },
  tab: { paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 12, fontWeight: '700' },
  list: { padding: 16, gap: 10 },
  card: { flexDirection: 'row', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 12, alignItems: 'flex-start' },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  cardTitle: { fontWeight: '700', fontSize: 15 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  cardBody2: { fontSize: 13, lineHeight: 18 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minWidth: 80 },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cardTime: { fontSize: 11, marginTop: 8 },
  empty: { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyTxt: { fontSize: 16 },
});

export default NotificationsScreen;
