import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
  Linking,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../store/ThemeContext';
import { backendDb } from '../services/backendGateway';
import { invokeBackendFunction } from '../config/backendFunctions';
import { useMessaging } from '../store/MessagingContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';
import { isAdminUser } from '../utils/userRole';
import { environment } from '../config/environment';

type ContentTable = 'posts' | 'stories' | 'post_comments' | 'reviews';
type ContentItem = {
  id: string; table: ContentTable; author_id?: string; user_id?: string; client_id?: string;
  caption?: string | null; body?: string | null; comment?: string | null; rating?: number;
  post_id?: string; booking_id?: string; moderation_status?: string | null;
  created_at: string | null; is_locked?: boolean; expires_at?: string | null; media_url?: string | null; image_url?: string | null;
};
type ContentQueue = { content: Record<ContentTable, Omit<ContentItem, 'table'>[]>; counts: Record<ContentTable, number> };
const CONTENT_TABLES: ContentTable[] = ['posts', 'stories', 'post_comments', 'reviews'];
const CONTENT_LABELS: Record<ContentTable, string> = { posts: 'Post', stories: 'Story', post_comments: 'Comment', reviews: 'Review' };

export const normalizeContentQueue = (response: ContentQueue): ContentItem[] => {
  if (!response?.content || !response.counts) throw new Error('Invalid content queue response.');
  return CONTENT_TABLES.flatMap(table => {
    const rows = response.content[table];
    if (!Array.isArray(rows) || !Number.isInteger(response.counts[table]) || response.counts[table] < rows.length) throw new Error('Invalid content queue response.');
    return rows.map(row => {
      if (!row || typeof row.id !== 'string' || !row.id || (row.created_at !== null && typeof row.created_at !== 'string')
        || (row.moderation_status != null && row.moderation_status !== 'pending')) throw new Error('Invalid pending content.');
      return { ...row, table };
    });
  });
};

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

type VerificationCandidate = {
  id: string;
  full_name: string | null;
  role: 'photographer' | 'model' | string;
  email?: string | null;
  created_at?: string | null;
  kyc_status: 'pending' | 'approved' | 'rejected' | null;
};

type PayoutReviewMethod = {
  id: string;
  user_id: string;
  user_name: string | null;
  user_role: string | null;
  bank_name: string;
  account_holder: string;
  account_masked: string;
  account_type: string;
  branch_code: string | null;
  is_default: boolean;
  verified: boolean;
  created_at: string;
};

type KycDocumentReview = {
  id: string;
  user_id: string;
  user_name: string | null;
  user_role: string | null;
  doc_type: string | null;
  status: 'pending' | 'approved' | 'rejected' | string | null;
  storage_path: string | null;
  signed_url: string | null;
  created_at: string | null;
};

const AdminModerationScreen: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Root'>>();
  const { startConversationWithUser } = useMessaging();
  const { state } = useAppData();
  const isAdmin = isAdminUser(state.currentUser);
  const apiMode = environment.backendProvider === 'api';

  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [violations, setViolations] = useState<PolicyViolation[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifications, setVerifications] = useState<VerificationCandidate[]>([]);
  const [payoutMethods, setPayoutMethods] = useState<PayoutReviewMethod[]>([]);
  const [bankEvidence, setBankEvidence] = useState<Record<string, string>>({});
  const [kycDocuments, setKycDocuments] = useState<KycDocumentReview[]>([]);
  const [tab, setTab] = useState<'content' | 'queue' | 'violations'>('content');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in_review' | 'escalated'>('all');
  const [content, setContent] = useState<ContentItem[]>([]);
  const [contentTotal, setContentTotal] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null);
  const [reason, setReason] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [preview, setPreview] = useState<{ url: string; media_type?: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const decisionBusy = useRef(false);
  const loadRequest = useRef(0);
  const previewRequest = useRef(0);

  const fetchModerationData = async () => {
    if (!isAdmin) return;
    const request = ++loadRequest.current;
    setLoading(true);
    setLoadError(null);
    try {
      const token = apiMode ? await getApiAccessToken() : null;
      if (apiMode && !token) throw new Error('Sign in again to load the moderation queue.');
      const [{ data: caseRows, error: caseErr }, { data: violationRows, error: violationErr }, { data: pendingData, error: pendingErr }, contentResponse] = await Promise.all([
        backendDb
          .from('moderation_cases')
          .select('id,reporter_id,target_user_id,target_type,target_id,reason,severity,status,sla_due_at,created_at')
          .order('created_at', { ascending: false })
          .limit(200),
        backendDb
          .from('policy_violations')
          .select('id,user_id,entity_type,entity_id,policy_code,severity,status,created_at')
          .order('created_at', { ascending: false })
          .limit(200),
        invokeBackendFunction('admin-review', { action: 'list_pending' }),
        apiMode ? apiClient.get<ContentQueue>('/admin/moderation/content', { token }) : Promise.resolve(null),
      ]);

      if (caseErr) throw caseErr;
      if (violationErr) throw violationErr;
      if (pendingErr) throw pendingErr;
      const contentRows = contentResponse ? normalizeContentQueue(contentResponse) : [];
      if (request !== loadRequest.current) return;

      setCases((caseRows ?? []) as ModerationCase[]);
      setViolations((violationRows ?? []) as PolicyViolation[]);
      setVerifications((pendingData?.verifications ?? []) as VerificationCandidate[]);
      setPayoutMethods((pendingData?.payout_methods ?? []) as PayoutReviewMethod[]);
      setKycDocuments((pendingData?.kyc_documents ?? []) as KycDocumentReview[]);
      setContent(contentRows);
      setContentTotal(contentResponse ? CONTENT_TABLES.reduce((sum, table) => sum + contentResponse.counts[table], 0) : null);
    } catch (err: any) {
      if (request === loadRequest.current) {
        setLoadError(err.message || 'Unable to load moderation queue.');
        setContentTotal(null);
      }
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedContent(null);
    setPreview(null);
    setContent([]);
    setContentTotal(null);
    setCases([]);
    setViolations([]);
    setKycDocuments([]);
    setVerifications([]);
    setPayoutMethods([]);
    fetchModerationData();
    return () => { loadRequest.current += 1; previewRequest.current += 1; };
  }, [state.currentUser?.id, isAdmin]);

  const openContent = async (item: ContentItem) => {
    setSelectedContent(item);
    setReason('');
    setDecisionError(null);
    setPreview(null);
    setPreviewError(null);
    const request = ++previewRequest.current;
    if (!apiMode || !['posts', 'stories'].includes(item.table) || (!item.media_url && !item.image_url)) return;
    try {
      const token = await getApiAccessToken();
      if (!token) throw new Error('Sign in again to preview content.');
      const response = await apiClient.get<{ url: string; media_type?: string }>(`/admin/moderation/content/${item.table}/${encodeURIComponent(item.id)}/preview`, { token });
      if (request === previewRequest.current) setPreview(response);
    } catch (error: any) {
      if (request === previewRequest.current) setPreviewError(error.message || 'Preview unavailable.');
    }
  };

  const decideContent = async (decision: 'approved' | 'rejected') => {
    if (!selectedContent || !isAdmin || !apiMode || decisionBusy.current || loadError) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < 3 || cleanReason.length > 1000) {
      setDecisionError('Enter a reason of 3 to 1000 characters.');
      return;
    }
    const item = selectedContent;
    const request = loadRequest.current;
    decisionBusy.current = true;
    setDeciding(true);
    setDecisionError(null);
    try {
      const token = await getApiAccessToken();
      if (!token) throw new Error('Sign in again before making a decision.');
      if (request !== loadRequest.current) return;
      const result = await apiClient.post<{ id: string; table: ContentTable; moderation_status: string; audit_event_id: string }>(
        '/admin/moderation/content/review',
        { table: item.table, id: item.id, decision, reason: cleanReason, expected_status: item.moderation_status || 'pending' }, { token },
      );
      if (result?.id !== item.id || result.table !== item.table || result.moderation_status !== decision || !result.audit_event_id) throw new Error('The decision could not be confirmed. Refresh the queue.');
      if (request !== loadRequest.current) return;
      previewRequest.current += 1;
      setSelectedContent(null);
      await fetchModerationData();
    } catch (error: any) {
      if (request === loadRequest.current) setDecisionError(error.message || 'Decision failed. The item remains in the queue.');
    } finally {
      decisionBusy.current = false;
      setDeciding(false);
    }
  };

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

  const updateVerification = async (userId: string, decision: 'approved' | 'rejected') => {
    try {
      const { error } = await invokeBackendFunction('admin-review', {
        action: 'decide_verification',
        user_id: userId,
        decision,
      });
      if (error) throw error;
      setVerifications((prev) => prev.filter((v) => v.id !== userId));
      Alert.alert('Verification updated', `Profile ${decision}.`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update verification status.');
    }
  };

  const updatePayoutDecision = async (payoutMethodId: string, decision: 'verified' | 'rejected') => {
    const evidence = (bankEvidence[payoutMethodId] || '').trim();
    if (evidence.length < 8) {
      Alert.alert('Evidence required', 'Enter the independent bank ownership verification reference.');
      return;
    }
    try {
      const { error } = await invokeBackendFunction('admin-review', {
        action: 'decide_payout',
        payout_method_id: payoutMethodId,
        decision,
        evidence_reference: evidence,
      });
      if (error) throw error;
      setPayoutMethods((prev) => prev.filter((m) => m.id !== payoutMethodId));
      Alert.alert('Payout review updated', `Method ${decision}.`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update payout method.');
    }
  };

  const reviewKycDocument = async (documentId: string, decision: 'approved' | 'rejected') => {
    try {
      const { error } = await invokeBackendFunction('admin-review', {
        action: 'decide_kyc_document',
        document_id: documentId,
        decision,
      });
      if (error) throw error;
      setKycDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
      Alert.alert('KYC updated', `Document ${decision}.`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update KYC document.');
    }
  };

  const kycLabel = (value?: string | null) => {
    switch (value) {
      case 'id_book': return 'ID Book / Passport';
      case 'passport': return 'Passport';
      case 'drivers_license': return 'Driver License';
      case 'selfie': return 'Selfie';
      case 'proof_of_address': return 'Proof of Address';
      default: return value ? value.replace(/_/g, ' ') : 'Document';
    }
  };

  const updateCaseStatus = async (id: string, nextStatus: ModerationCase['status']) => {
    try {
      const { error } = await backendDb
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
      const { error } = await backendDb
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
          <Text style={styles.actionText}>Mark Blocked</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#7c3aed' }]} onPress={() => updateViolationStatus(item.id, 'removed')}>
          <Text style={styles.actionText}>Mark Removed</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#16a34a' }]} onPress={() => updateViolationStatus(item.id, 'resolved')}>
          <Text style={styles.actionText}>Resolve</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderContent = ({ item }: { item: ContentItem }) => (
    <View testID={`content-${item.table}-${item.id}`} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>{CONTENT_LABELS[item.table]}</Text>
      <Text style={[styles.meta, { color: colors.textMuted }]}>Author: {item.author_id || item.user_id || item.client_id || 'Unknown'}</Text>
      <Text style={[styles.meta, { color: colors.text }]}>{item.caption || item.body || item.comment || 'Media content'}</Text>
      {item.rating != null ? <Text style={[styles.meta, { color: colors.textMuted }]}>Rating: {Number(item.rating)}/5</Text> : null}
      {item.is_locked ? <Text style={[styles.meta, { color: colors.textMuted }]}>Private / locked</Text> : null}
      {item.post_id || item.booking_id ? <Text style={[styles.code, { color: colors.textMuted }]}>Parent: {item.post_id || item.booking_id}</Text> : null}
      <Text style={[styles.code, { color: colors.textMuted }]}>{item.id}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Review ${CONTENT_LABELS[item.table].toLowerCase()} ${item.id}`} disabled={!!loadError || loading || deciding || !apiMode}
        style={[styles.messageBtn, { borderColor: colors.border, marginTop: 10 }]} onPress={() => openContent(item)}>
        <Ionicons name="eye-outline" size={16} color={colors.text} />
        <Text style={[styles.messageText, { color: colors.text }]}>Review content</Text>
      </TouchableOpacity>
    </View>
  );

  if (!isAdmin) return <View style={[styles.center, { backgroundColor: colors.bg }]}><Text accessibilityRole="alert" style={{ color: colors.text }}>Administrator access required.</Text></View>;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}> 
      <View style={styles.header}>
        <Text style={[styles.screenTitle, { color: colors.text }]}>Moderation Triage</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh moderation queue" disabled={loading || deciding} onPress={fetchModerationData}>
          <Ionicons name="refresh" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Pending Content</Text>
          <Text style={[styles.kpiValue, { color: colors.text }]}>{contentTotal === null ? '--' : contentTotal}</Text>
        </View>
        <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Open / Overdue</Text>
          <Text style={[styles.kpiValue, { color: slaBreached ? '#ef4444' : colors.text }]}>{openCount}/{slaBreached}</Text>
        </View>
        <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>KYC Docs</Text>
          <Text style={[styles.kpiValue, { color: kycDocuments.length > 0 ? '#f59e0b' : colors.text }]}>{kycDocuments.length}</Text>
        </View>
        <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Payout Pending</Text>
          <Text style={[styles.kpiValue, { color: colors.text }]}>{payoutMethods.length}</Text>
        </View>
      </View>

      <ScrollView style={[styles.reviewQueues, tab !== 'queue' && { display: 'none' }]}>
      {tab === 'queue' && kycDocuments.length > 0 && (
        <View style={styles.verificationWrap}>
          <Text style={[styles.blockTitle, { color: colors.text }]}>Pending KYC Documents</Text>
          {kycDocuments.map((doc) => (
            <View key={doc.id} testID={`kyc-${doc.id}`} style={[styles.kycCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.kycHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.verificationName, { color: colors.text }]}>{doc.user_name || 'Unknown creator'}</Text>
                  <Text style={[styles.verificationMeta, { color: colors.textMuted }]}>
                    {String(doc.user_role ?? 'creator').toUpperCase()} · {doc.user_id.slice(0, 8)}
                  </Text>
                </View>
                <View style={[styles.docTypeBadge, { borderColor: '#f59e0b', backgroundColor: '#f59e0b22' }]}>
                  <Text style={{ color: '#f59e0b', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' }}>
                    {kycLabel(doc.doc_type)}
                  </Text>
                </View>
              </View>
              {doc.signed_url ? (
                <View style={{ gap: 8 }}>
                  <Image source={{ uri: doc.signed_url }} style={styles.kycPreview} resizeMode="cover" />
                  <TouchableOpacity
                    style={[styles.smallAction, { backgroundColor: '#3b82f6', alignSelf: 'flex-start' }]}
                    onPress={() => Linking.openURL(doc.signed_url!)}
                  >
                    <Text style={styles.smallActionText}>View Full Image</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={[styles.kycPreview, { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>No preview</Text>
                </View>
              )}
              <View style={styles.actions}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Approve KYC document ${doc.id}`} style={[styles.actionBtn, { backgroundColor: '#16a34a' }]} onPress={() => reviewKycDocument(doc.id, 'approved')}>
                  <Text style={styles.actionText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Reject KYC document ${doc.id}`} style={[styles.actionBtn, { backgroundColor: '#dc2626' }]} onPress={() => reviewKycDocument(doc.id, 'rejected')}>
                  <Text style={styles.actionText}>Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {tab === 'queue' && verifications.length > 0 && (
        <View style={styles.verificationWrap}>
          <Text style={[styles.blockTitle, { color: colors.text }]}>Pending Creator Verification</Text>
          {verifications.map((v) => (
            <View key={v.id} testID={`verification-${v.id}`} style={[styles.verificationRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.verificationName, { color: colors.text }]}>{v.full_name || 'Unnamed creator'}</Text>
                <Text style={[styles.verificationMeta, { color: colors.textMuted }]}>{String(v.role).toUpperCase()} · {v.id.slice(0, 8)}</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Approve identity ${v.id}`} style={[styles.smallAction, { backgroundColor: '#16a34a' }]} onPress={() => updateVerification(v.id, 'approved')}>
                <Text style={styles.smallActionText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Reject identity ${v.id}`} style={[styles.smallAction, { backgroundColor: '#dc2626' }]} onPress={() => updateVerification(v.id, 'rejected')}>
                <Text style={styles.smallActionText}>Reject</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {tab === 'queue' && payoutMethods.length > 0 && (
        <View style={styles.verificationWrap}>
          <Text style={[styles.blockTitle, { color: colors.text }]}>Pending Payout Verification</Text>
          {payoutMethods.map(m => (
            <TextInput key={m.id} accessibilityLabel={`Bank evidence for ${m.id}`} placeholder="Independent bank ownership evidence reference"
              placeholderTextColor={colors.textMuted} value={bankEvidence[m.id] || ''} maxLength={255}
              onChangeText={value => setBankEvidence(prev => ({ ...prev, [m.id]: value }))}
              style={[styles.reasonInput, { color: colors.text, borderColor: colors.border, minHeight: 48 }]} />
          ))}
          {payoutMethods.map((m) => (
            <View key={m.id} style={[styles.verificationRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.verificationName, { color: colors.text }]}>{m.user_name || 'Unknown creator'} · {m.bank_name}</Text>
                <Text style={[styles.verificationMeta, { color: colors.textMuted }]}>{m.account_holder} · {m.account_masked} · {m.account_type}</Text>
              </View>
              <TouchableOpacity style={[styles.smallAction, { backgroundColor: '#16a34a' }]} onPress={() => updatePayoutDecision(m.id, 'verified')}>
                <Text style={styles.smallActionText}>Verify</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallAction, { backgroundColor: '#dc2626' }]} onPress={() => updatePayoutDecision(m.id, 'rejected')}>
                <Text style={styles.smallActionText}>Reject</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      </ScrollView>

      <View style={styles.tabRow}>
        <TouchableOpacity accessibilityRole="tab" accessibilityLabel="Content" accessibilityState={{ selected: tab === 'content' }} style={[styles.tab, tab === 'content' && { borderBottomColor: colors.accent }]} onPress={() => setTab('content')}>
          <Text style={[styles.tabText, { color: tab === 'content' ? colors.text : colors.textMuted }]}>CONTENT</Text>
        </TouchableOpacity>
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

      {loadError ? <Text accessibilityRole="alert" style={[styles.queueError, { color: colors.destructive }]}>{loadError}</Text> : null}
      {!apiMode && tab === 'content' ? <Text style={[styles.queueError, { color: colors.textMuted }]}>Content decisions are unavailable for this backend.</Text> : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={tab === 'content' ? content : tab === 'queue' ? filteredCases : violations as any}
          keyExtractor={(item: any) => `${item.table || tab}-${item.id}`}
          renderItem={tab === 'content' ? (renderContent as any) : tab === 'queue' ? (renderCase as any) : (renderViolation as any)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<View style={styles.center}><Text style={{ color: colors.textMuted }}>{loadError ? 'Queue unavailable' : tab === 'content' ? 'No pending content' : 'No items'}</Text></View>}
        />
      )}
      <Modal visible={!!selectedContent} transparent animationType="fade" onRequestClose={() => { if (!deciding) { previewRequest.current += 1; setSelectedContent(null); } }}>
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={[styles.reviewPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.rowTop}>
              <Text style={[styles.screenTitle, { color: colors.text }]}>Content decision</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close content decision" disabled={deciding} onPress={() => { previewRequest.current += 1; setSelectedContent(null); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={[styles.meta, { color: colors.textMuted }]}>{selectedContent ? CONTENT_LABELS[selectedContent.table] : ''} {selectedContent?.id}</Text>
              <Text style={[styles.title, { color: colors.text }]}>{selectedContent?.caption || selectedContent?.body || selectedContent?.comment || 'Media content'}</Text>
              {selectedContent?.is_locked ? <Text style={[styles.meta, { color: colors.textMuted }]}>Private / locked</Text> : null}
              {preview && !preview.media_type?.startsWith('video') ? <Image source={{ uri: preview.url }} style={styles.contentPreview} resizeMode="contain" /> : null}
              {preview?.media_type?.startsWith('video') ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open content video preview" onPress={() => Linking.openURL(preview.url).catch(() => setPreviewError('Could not open video preview.'))}><Text style={{ color: colors.accent }}>Open video preview</Text></TouchableOpacity> : null}
              {previewError ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{previewError}</Text> : null}
              <Text style={[styles.filterText, { color: colors.text, marginVertical: 10 }]}>Decision reason</Text>
              <TextInput accessibilityLabel="Decision reason" multiline maxLength={1000} value={reason} onChangeText={setReason} editable={!deciding}
                style={[styles.reasonInput, { color: colors.text, borderColor: colors.border }]} />
              {decisionError ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{decisionError}</Text> : null}
            </ScrollView>
            <View style={styles.actions}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Approve content" disabled={deciding || !!loadError || !apiMode}
                style={[styles.actionBtn, { backgroundColor: '#167344' }]} onPress={() => decideContent('approved')}>
                <Text style={styles.actionText}>{deciding ? 'Saving...' : 'Approve'}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Reject content" disabled={deciding || !!loadError || !apiMode}
                style={[styles.actionBtn, { backgroundColor: '#b42318' }]} onPress={() => decideContent('rejected')}>
                <Text style={styles.actionText}>{deciding ? 'Saving...' : 'Reject'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  screenTitle: { fontSize: 22, fontWeight: '900' },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  kpiCard: { flexGrow: 1, flexBasis: 140, borderWidth: 1, borderRadius: 8, padding: 12 },
  howWrap: { paddingHorizontal: 16, marginBottom: 10 },
  kpiLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  kpiValue: { fontSize: 22, fontWeight: '900', marginTop: 4 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 18 },
  verificationWrap: { paddingHorizontal: 16, marginBottom: 10, gap: 8 },
  blockTitle: { fontSize: 14, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  verificationRow: { borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  verificationName: { fontSize: 14, fontWeight: '800' },
  verificationMeta: { fontSize: 11, marginTop: 2 },
  smallAction: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  smallActionText: { color: '#fff', fontWeight: '800', fontSize: 12 },
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
  docTypeBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  kycCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  kycHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kycPreview: { width: '100%', height: 160, borderRadius: 12 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  queueError: { paddingHorizontal: 16, paddingVertical: 10 },
  reviewQueues: { maxHeight: 280, flexGrow: 0 },
  modalBackdrop: { flex: 1, padding: 16, backgroundColor: '#0008', alignItems: 'center', justifyContent: 'center' },
  reviewPanel: { width: '100%', maxWidth: 620, maxHeight: '90%', borderWidth: 1, borderRadius: 8, padding: 16 },
  reasonInput: { borderWidth: 1, borderRadius: 4, minHeight: 100, padding: 10, textAlignVertical: 'top' },
  contentPreview: { width: '100%', height: 220, marginVertical: 12 },
});

export default AdminModerationScreen;
