import React, { useState, useEffect, useMemo } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../store/ThemeContext';
import { supabase } from '../config/supabaseClient';
import { useMessaging } from '../store/MessagingContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

type ModerationCase = {
  id: string;
  reporter_id: string | null;
  target_user_id: string | null;
  target_type: 'post' | 'message' | 'profile' | 'booking' | 'payment' | 'other';
  target_id: string | null;
  reason: string;
  severity: number;
  status: 'open' | 'in_review' | 'escalated' | 'resolved' | 'rejected';
  sla_due_at: string | null;
  created_at: string;
};

type PolicyViolation = {
  id: string;
  user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  policy_code: string;
  severity: number;
  status: 'warning' | 'blocked' | 'removed' | 'resolved';
  created_at: string;
};

const AdminModerationScreen: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Root'>>();
  const { startConversationWithUser } = useMessaging();

  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [violations, setViolations] = useState<PolicyViolation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'queue' | 'violations'>('queue');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in_review' | 'escalated'>('all');

  const fetchModerationData = async () => {
    setLoading(true);
    try {
      const [{ data: caseRows, error: caseErr }, { data: violationRows, error: violationErr }] = await Promise.all([
        supabase
          .from('moderation_cases')
          .select('id,reporter_id,target_user_id,target_type,target_id,reason,severity,status,sla_due_at,created_at')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('policy_violations')
          .select('id,user_id,entity_type,entity_id,policy_code,severity,status,created_at')
          .order('created_at', { ascending: false })
          .limit(200),
      ]);

      if (caseErr) throw caseErr;
      if (violationErr) throw violationErr;

      setCases((caseRows ?? []) as ModerationCase[]);
      setViolations((violationRows ?? []) as PolicyViolation[]);
    } catch (err: any) {
      console.warn('Moderation fetch error:', err.message);
      Alert.alert('Error', err.message || 'Unable to load moderation queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModerationData();
  }, []);

  const filteredCases = useMemo(() => {
    const base = statusFilter === 'all' ? cases : cases.filter((c) => c.status === statusFilter);
    return [...base].sort((a, b) => {
      const dueA = a.sla_due_at ? new Date(a.sla_due_at).getTime() : Number.MAX_SAFE_INTEGER;
      const dueB = b.sla_due_at ? new Date(b.sla_due_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (dueA !== dueB) return dueA - dueB;
      return b.severity - a.severity;
    });
  }, [cases, statusFilter]);

  const openCount = cases.filter((c) => ['open', 'in_review', 'escalated'].includes(c.status)).length;
  const slaBreached = cases.filter((c) => c.sla_due_at && new Date(c.sla_due_at).getTime() < Date.now() && ['open', 'in_review', 'escalated'].includes(c.status)).length;

  const updateCaseStatus = async (id: string, nextStatus: ModerationCase['status']) => {
    try {
      const { error } = await supabase
        .from('moderation_cases')
        .update({ status: nextStatus })
        .eq('id', id);
      if (error) throw error;
      setCases((prev) => prev.map((c) => (c.id === id ? { ...c, status: nextStatus } : c)));
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update case status.');
    }
  };

  const updateViolationStatus = async (id: string, nextStatus: PolicyViolation['status']) => {
    try {
      const { error } = await supabase
        .from('policy_violations')
        .update({ status: nextStatus })
        .eq('id', id);
      if (error) throw error;
      setViolations((prev) => prev.map((v) => (v.id === id ? { ...v, status: nextStatus } : v)));
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update violation status.');
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

  const slaState = (item: ModerationCase) => {
    if (!item.sla_due_at) return { label: 'No SLA', color: '#64748b' };
    const due = new Date(item.sla_due_at).getTime();
    if (due < Date.now()) return { label: 'SLA BREACHED', color: '#ef4444' };
    const hours = Math.max(0, Math.ceil((due - Date.now()) / (1000 * 60 * 60)));
    return { label: `${hours}h left`, color: hours <= 4 ? '#f59e0b' : '#10b981' };
  };

  const renderCase = ({ item }: { item: ModerationCase }) => {
    const sla = slaState(item);
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <View style={styles.rowTop}>
          <View style={[styles.badge, { backgroundColor: `${sla.color}22` }]}>
            <Text style={[styles.badgeText, { color: sla.color }]}>{sla.label}</Text>
          </View>
          <Text style={[styles.meta, { color: colors.textMuted }]}>{new Date(item.created_at).toLocaleString()}</Text>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>{item.reason}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>Target: {item.target_type} · Severity {item.severity} · Status {item.status}</Text>
        <Text style={[styles.code, { color: colors.textMuted }]}>Case #{item.id.slice(0, 8)}</Text>

        <View style={styles.messageRow}>
          <TouchableOpacity style={[styles.messageBtn, { borderColor: colors.border }]} onPress={() => openChatWithUser(item.reporter_id, 'Reporter')}>
            <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.text} />
            <Text style={[styles.messageText, { color: colors.text }]}>Reporter</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.messageBtn, { borderColor: colors.border }]} onPress={() => openChatWithUser(item.target_user_id, 'Target')}>
            <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.text} />
            <Text style={[styles.messageText, { color: colors.text }]}>Target</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#0ea5e9' }]} onPress={() => updateCaseStatus(item.id, 'in_review')}>
            <Text style={styles.actionText}>In Review</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#f59e0b' }]} onPress={() => updateCaseStatus(item.id, 'escalated')}>
            <Text style={styles.actionText}>Escalate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#16a34a' }]} onPress={() => updateCaseStatus(item.id, 'resolved')}>
            <Text style={styles.actionText}>Resolve</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderViolation = ({ item }: { item: PolicyViolation }) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}> 
      <View style={styles.rowTop}>
        <View style={[styles.badge, { backgroundColor: '#ef444422' }]}>
          <Text style={[styles.badgeText, { color: '#ef4444' }]}>SEV {item.severity}</Text>
        </View>
        <Text style={[styles.meta, { color: colors.textMuted }]}>{new Date(item.created_at).toLocaleString()}</Text>
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{item.policy_code}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>Entity: {item.entity_type} · Status: {item.status}</Text>
      <Text style={[styles.code, { color: colors.textMuted }]}>Violation #{item.id.slice(0, 8)}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#dc2626' }]} onPress={() => updateViolationStatus(item.id, 'blocked')}>
          <Text style={styles.actionText}>Block</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#7c3aed' }]} onPress={() => updateViolationStatus(item.id, 'removed')}>
          <Text style={styles.actionText}>Remove</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#16a34a' }]} onPress={() => updateViolationStatus(item.id, 'resolved')}>
          <Text style={styles.actionText}>Resolve</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}> 
      <View style={styles.header}>
        <Text style={[styles.screenTitle, { color: colors.text }]}>Moderation Triage</Text>
        <TouchableOpacity onPress={fetchModerationData}>
          <Ionicons name="refresh" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Open Queue</Text>
          <Text style={[styles.kpiValue, { color: colors.text }]}>{openCount}</Text>
        </View>
        <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>SLA Breached</Text>
          <Text style={[styles.kpiValue, { color: '#ef4444' }]}>{slaBreached}</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, tab === 'queue' && { borderBottomColor: colors.accent }]} onPress={() => setTab('queue')}>
          <Text style={[styles.tabText, { color: tab === 'queue' ? colors.text : colors.textMuted }]}>QUEUE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'violations' && { borderBottomColor: colors.accent }]} onPress={() => setTab('violations')}>
          <Text style={[styles.tabText, { color: tab === 'violations' ? colors.text : colors.textMuted }]}>VIOLATIONS</Text>
        </TouchableOpacity>
      </View>

      {tab === 'queue' && (
        <View style={styles.filterRow}>
          {(['all', 'open', 'in_review', 'escalated'] as const).map((f) => (
            <TouchableOpacity key={f} style={[styles.filterBtn, { borderColor: colors.border, backgroundColor: statusFilter === f ? colors.accent + '22' : 'transparent' }]} onPress={() => setStatusFilter(f)}>
              <Text style={[styles.filterText, { color: statusFilter === f ? colors.text : colors.textMuted }]}>{f.replace('_', ' ').toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={tab === 'queue' ? filteredCases : violations}
          keyExtractor={(item: any) => item.id}
          renderItem={tab === 'queue' ? (renderCase as any) : (renderViolation as any)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<View style={styles.center}><Text style={{ color: colors.textMuted }}>No items</Text></View>}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  screenTitle: { fontSize: 22, fontWeight: '900' },
  kpiRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 10 },
  kpiCard: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12 },
  kpiLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  kpiValue: { fontSize: 22, fontWeight: '900', marginTop: 4 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 18 },
  tab: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontWeight: '800', fontSize: 12 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginVertical: 10, flexWrap: 'wrap' },
  filterBtn: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  filterText: { fontSize: 11, fontWeight: '700' },
  list: { padding: 16, paddingBottom: 36 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 10, fontWeight: '900' },
  title: { fontWeight: '800', fontSize: 15, marginBottom: 5 },
  meta: { fontSize: 12 },
  code: { fontSize: 11, marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  messageRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  messageBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  messageText: { fontWeight: '700', fontSize: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: { flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
});

export default AdminModerationScreen;
