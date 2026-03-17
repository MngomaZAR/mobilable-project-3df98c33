import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { useMessaging } from '../store/MessagingContext';
import { NewMessageModal } from '../components/NewMessageModal';
import { supabase } from '../config/supabaseClient';

type Navigation = StackNavigationProp<RootStackParamList>;

const AdminDashboardScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state } = useAppData();
  const { startConversationWithUser } = useMessaging();
  const [showNewMessage, setShowNewMessage] = React.useState(false);
  const [liveRevenue, setLiveRevenue] = useState<number | null>(null);
  const [opsMetrics, setOpsMetrics] = useState({
    dispatchOpen: 0,
    avgEtaConfidence: 0,
    moderationOpen: 0,
    payoutExceptions: 0,
  });
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const fetchRevenue = React.useCallback(async () => {
    try {
      const { data, error } = await supabase.from('earnings').select('amount');
      if (!error && data) {
        const total = data.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
        setLiveRevenue(total);
      }
    } catch {
      // silent fallback
    }
  }, []);

  const fetchOpsMetrics = React.useCallback(async () => {
    try {
      const [dispatchRes, etaRes, modRes, payoutRes] = await Promise.all([
        supabase.from('dispatch_requests').select('id', { count: 'exact', head: true }).in('status', ['queued', 'offered']),
        supabase.from('eta_snapshots').select('eta_confidence').order('created_at', { ascending: false }).limit(100),
        supabase.from('moderation_cases').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_review', 'escalated']),
        supabase.from('payments').select('id', { count: 'exact', head: true }).in('status', ['failed', 'cancelled']),
      ]);

      const avgEtaConfidence = etaRes.data && etaRes.data.length > 0
        ? etaRes.data.reduce((acc: number, row: any) => acc + Number(row.eta_confidence || 0), 0) / etaRes.data.length
        : 0;

      setOpsMetrics({
        dispatchOpen: dispatchRes.count ?? 0,
        avgEtaConfidence,
        moderationOpen: modRes.count ?? 0,
        payoutExceptions: payoutRes.count ?? 0,
      });
    } catch {
      // keep defaults
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      const run = async () => {
        if (!active) return;
        await Promise.all([fetchRevenue(), fetchOpsMetrics()]);
      };
      run();
      const timer = setInterval(run, 20000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [fetchOpsMetrics, fetchRevenue]),
  );

  const pendingBookings = useMemo(
    () => state.bookings.filter((booking) => booking.status === 'pending').length,
    [state.bookings]
  );
  const activeJobs = useMemo(
    () => state.bookings.filter((booking) => booking.status === 'accepted').length,
    [state.bookings]
  );

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: Math.max(12, insets.top + 4), paddingBottom: Math.max(120, insets.bottom + 96) }]}>
        <View style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eyebrow, { color: colors.accent }]}>Control Center</Text>
              <Text style={[styles.title, { color: colors.text }]}>Admin Overview</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Platform health and operations dashboard.</Text>
            </View>
            <TouchableOpacity style={[styles.heroBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setShowNewMessage(true)}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} />
              <Text style={[styles.heroBtnText, { color: colors.text }]}>New Message</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Dispatch Open</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{opsMetrics.dispatchOpen}</Text>
            <Text style={[styles.statMeta, { color: colors.accent }]}>Queued/offered</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>ETA Confidence</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{(opsMetrics.avgEtaConfidence * 100).toFixed(0)}%</Text>
            <Text style={[styles.statMeta, { color: '#10b981' }]}>Rolling avg</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border, marginRight: 0 }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Safety/Payout</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{opsMetrics.moderationOpen}/{opsMetrics.payoutExceptions}</Text>
            <Text style={[styles.statMeta, { color: colors.destructive }]}>Open mod / pay issues</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Pending</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{pendingBookings}</Text>
            <Text style={[styles.statMeta, { color: colors.destructive }]}>Attention</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Active Jobs</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{activeJobs}</Text>
            <Text style={[styles.statMeta, { color: colors.accent }]}>Live now</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border, marginRight: 0 }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Revenue</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {liveRevenue === null ? '...' : `R${liveRevenue.toLocaleString('en-ZA')}`}
            </Text>
            <Text style={[styles.statMeta, { color: '#10b981' }]}>Completed jobs</Text>
          </View>

        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Today Priorities</Text>
          <View style={styles.priorityRow}>
            <View style={[styles.priorityPill, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <Text style={[styles.priorityValue, { color: colors.text }]}>{pendingBookings}</Text>
              <Text style={[styles.priorityLabel, { color: colors.textMuted }]}>Pending</Text>
            </View>
            <View style={[styles.priorityPill, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <Text style={[styles.priorityValue, { color: colors.text }]}>{opsMetrics.moderationOpen}</Text>
              <Text style={[styles.priorityLabel, { color: colors.textMuted }]}>Moderation</Text>
            </View>
            <View style={[styles.priorityPill, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <Text style={[styles.priorityValue, { color: colors.text }]}>{opsMetrics.payoutExceptions}</Text>
              <Text style={[styles.priorityLabel, { color: colors.textMuted }]}>Payout Issues</Text>
            </View>
          </View>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => navigation.navigate('AdminModeration')}>
            <Ionicons name="flash-outline" size={18} color={colors.accent} />
            <Text style={[styles.actionText, { color: colors.text }]}>Resolve priority queue</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Trust & Safety</Text>
          <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
            Review reported content, user disputes, and community standards.
          </Text>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => navigation.navigate('AdminModeration')}>
            <Ionicons name="shield-half-outline" size={18} color={colors.destructive} />
            <Text style={[styles.actionText, { color: colors.text }]}>Moderation queue</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Operations</Text>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => navigation.navigate('Root', { screen: 'Bookings' })}>
            <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            <Text style={[styles.actionText, { color: colors.text }]}>Browse all bookings</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => navigation.navigate('Root', { screen: 'Chat' })}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
            <Text style={[styles.actionText, { color: colors.text }]}>Open conversations</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => navigation.navigate('Compliance')}>
            <Ionicons name="file-tray-full-outline" size={18} color={colors.text} />
            <Text style={[styles.actionText, { color: colors.text }]}>Compliance & Logs</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <NewMessageModal
        visible={showNewMessage}
        onClose={() => setShowNewMessage(false)}
        profiles={state.profiles ?? []}
        currentUserId={state.currentUser?.id}
        onSelectUser={async (user) => {
          const convo = await startConversationWithUser(user.id, user.full_name ?? 'User');
          setShowNewMessage(false);
          navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 20, paddingBottom: 120 },
  hero: { marginBottom: 24 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eyebrow: { fontWeight: '900', marginBottom: 4, letterSpacing: 1, fontSize: 12, textTransform: 'uppercase' },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  subtitle: { fontSize: 16, marginTop: 4 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  heroBtnText: { fontWeight: '700', fontSize: 13 },
  statsRow: { flexDirection: 'row', marginBottom: 20, gap: 10 },
  statCard: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
  },
  statLabel: { fontWeight: '700', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 22, fontWeight: '900', marginTop: 4 },
  statMeta: { fontWeight: '700', fontSize: 11, marginTop: 4 },
  card: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    marginBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  cardTitle: { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  cardBody: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
  },
  actionText: { fontWeight: '700', fontSize: 15 },
  priorityRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  priorityPill: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' },
  priorityValue: { fontSize: 18, fontWeight: '900' },
  priorityLabel: { marginTop: 2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
});

export default AdminDashboardScreen;
