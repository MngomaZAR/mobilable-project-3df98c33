import React, { useState, useEffect } from 'react';
import { 
  FlatList, 
  StyleSheet, 
  Text, 
  TouchableOpacity, 
  View, 
  ActivityIndicator, 
  Alert,
  Image,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../store/ThemeContext';
import { supabase } from '../config/supabaseClient';
import { useMessaging } from '../store/MessagingContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

interface Report {
  id: string;
  target_id: string;
  target_type: 'post' | 'profile' | 'comment';
  reporter_id: string;
  reason: string;
  status: 'pending' | 'resolved' | 'dismissed';
  created_at: string;
  metadata?: any;
}

const AdminModerationScreen: React.FC = () => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Root'>>();
  const { startConversationWithUser } = useMessaging();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReports(data || []);
    } catch (err: any) {
      console.warn('Error fetching reports:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const resolveReport = async (reportId: string, status: 'resolved' | 'dismissed') => {
    try {
      const { error } = await supabase
        .from('reports')
        .update({ status })
        .eq('id', reportId);

      if (error) throw error;
      
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status } : r));
      Alert.alert('Success', `Report ${status}`);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const openChatWithUser = async (userId?: string | null, label?: string) => {
    if (!userId) return;
    try {
      const convo = await startConversationWithUser(userId, label ?? 'User');
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch {
      navigation.navigate('Root', { screen: 'Chat' });
    }
  };

  const renderReportItem = ({ item }: { item: Report }) => (
    <View style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.reportHeader}>
        <View style={[styles.badge, { backgroundColor: item.status === 'pending' ? colors.destructive + '20' : colors.accent + '20' }]}>
            <Text style={[styles.badgeText, { color: item.status === 'pending' ? colors.destructive : colors.accent }]}>
                {item.status.toUpperCase()}
            </Text>
        </View>
        <Text style={[styles.date, { color: colors.textMuted }]}>{new Date(item.created_at).toLocaleDateString()}</Text>
      </View>

      <View style={styles.reportBody}>
        <Text style={[styles.type, { color: colors.textMuted }]}>
            TARGET: <Text style={{ color: colors.text, fontWeight: '700' }}>{item.target_type.toUpperCase()}</Text>
        </Text>
        <Text style={[styles.reason, { color: colors.text }]}>{item.reason}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>ID: {item.target_id}</Text>
      </View>

      <View style={styles.messageRow}>
        <TouchableOpacity
          style={[styles.messageBtn, { borderColor: colors.border }]}
          onPress={() => openChatWithUser(item.reporter_id, 'Reporter')}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.text} />
          <Text style={[styles.messageText, { color: colors.text }]}>Message reporter</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.messageBtn, { borderColor: colors.border }]}
          onPress={() => openChatWithUser(item.target_id, 'Reported user')}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.text} />
          <Text style={[styles.messageText, { color: colors.text }]}>Message target</Text>
        </TouchableOpacity>
      </View>

      {item.status === 'pending' && (
        <View style={styles.actions}>
            <TouchableOpacity 
                style={[styles.actionBtn, { backgroundColor: colors.destructive }]}
                onPress={() => Alert.alert('Resolve', 'Take action and mark as resolved?', [
                    { text: 'Cancel' },
                    { text: 'Resolve', onPress: () => resolveReport(item.id, 'resolved') }
                ])}
            >
                <Ionicons name="trash" size={16} color="#fff" />
                <Text style={styles.actionBtnText}>Take Action</Text>
            </TouchableOpacity>

            <TouchableOpacity 
                style={[styles.actionBtn, { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }]}
                onPress={() => resolveReport(item.id, 'dismissed')}
            >
                <Ionicons name="close-circle" size={16} color={colors.text} />
                <Text style={[styles.actionBtnText, { color: colors.text }]}>Dismiss</Text>
            </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Moderation Queue</Text>
        <TouchableOpacity onPress={fetchReports}>
            <Ionicons name="refresh" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(item) => item.id}
          renderItem={renderReportItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
                <Ionicons name="checkmark-circle" size={64} color={colors.accent} />
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>No pending reports.</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  reportCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  date: {
    fontSize: 12,
  },
  reportBody: {
    marginBottom: 16,
  },
  type: {
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reason: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  meta: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  messageRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  messageBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  messageText: {
    fontWeight: '700',
    fontSize: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
  }
});

export default AdminModerationScreen;
