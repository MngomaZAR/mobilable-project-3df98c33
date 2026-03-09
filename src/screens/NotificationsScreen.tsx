import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../store/ThemeContext';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { StackNavigationProp } from '@react-navigation/stack';

type Navigation = StackNavigationProp<RootStackParamList, 'Notifications'>;

interface NotificationItem {
  id: string;
  event_type: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

const NotificationsScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { state } = useAppData();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!hasSupabase || !state.currentUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_events')
        .select('id, event_type, title, body, status, created_at')
        .eq('user_id', state.currentUser.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error) setNotifications((data ?? []) as NotificationItem[]);
    } finally {
      setLoading(false);
    }
  }, [state.currentUser]);

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

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchNotifications} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.iconBox, { backgroundColor: colors.accent + '22' }]}>
              <Ionicons name={iconFor(item.event_type) as any} size={20} color={colors.accent} />
            </View>
            <View style={styles.cardBody}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
              <Text style={[styles.cardBody2, { color: colors.textSecondary }]}>{item.body}</Text>
              <Text style={[styles.cardTime, { color: colors.textMuted }]}>
                {new Date(item.created_at).toLocaleString()}
              </Text>
            </View>
          </View>
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
  list: { padding: 16, gap: 10 },
  card: { flexDirection: 'row', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 12, alignItems: 'flex-start' },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardTitle: { fontWeight: '700', fontSize: 15, marginBottom: 2 },
  cardBody2: { fontSize: 13, lineHeight: 18 },
  cardTime: { fontSize: 11, marginTop: 4 },
  empty: { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyTxt: { fontSize: 16 },
});

export default NotificationsScreen;
