import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { backendDb } from '../services/backendGateway';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { RootStackParamList } from '../navigation/types';
import { uploadImage } from '../services/uploadService';
import { environment } from '../config/environment';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';

type DocType = 'id_book' | 'passport' | 'drivers_license' | 'selfie' | 'proof_of_address';
type Nav = StackNavigationProp<RootStackParamList>;
type DocumentState = Record<DocType, { uri: string; status: string } | null>;
const emptyDocuments = (): DocumentState => ({ id_book: null, passport: null, drivers_license: null, selfie: null, proof_of_address: null });

const DOC_SLOTS = [
  { key: 'id_book' as DocType,          label: 'SA ID / Passport',   icon: 'card-outline',   hint: 'Clear photo of your green ID book or passport', required: true  },
  { key: 'selfie' as DocType,           label: 'Selfie with ID',     icon: 'person-outline', hint: 'Hold your ID next to your face in good light',   required: true  },
  { key: 'proof_of_address' as DocType, label: 'Proof of Address',   icon: 'home-outline',   hint: 'Utility bill or bank statement under 3 months',  required: false },
];

const KYCScreen: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { state, revalidateSession } = useAppData();
  const userId = state.currentUser?.id;
  const kycStatus = state.currentUser?.kyc_status;

  const [docs, setDocs] = useState<DocumentState>(emptyDocuments);
  const [uploading, setUploading] = useState<DocType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const uploadLock = useRef(false);
  const submitLock = useRef(false);
  const currentUser = useRef(userId);
  currentUser.current = userId;

  useEffect(() => {
    let active = true;
    setDocs(emptyDocuments());
    setSubmitted(false);
    setLoadError(null);
    setLoading(true);
    if (!userId) {
      setLoading(false);
      setLoadError('Sign in to manage identity documents.');
      return;
    }
    Promise.resolve(backendDb.from('kyc_documents').select('doc_type, status').eq('user_id', userId))
      .then(({ data, error }) => {
        if (error) throw error;
        if (!active) return;
        const updates = emptyDocuments();
        (data || []).forEach((row: { doc_type: string; status: string }) => {
          if (Object.prototype.hasOwnProperty.call(updates, row.doc_type)) {
            updates[row.doc_type as DocType] = { uri: 'uploaded', status: row.status };
          }
        });
        setDocs(previous => ({ ...updates, ...Object.fromEntries(Object.entries(previous).filter(([, value]) => value !== null)) }));
      })
      .catch((error: Error) => { if (active) setLoadError(error.message || 'Could not load your documents.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, loadAttempt]);

  const pickAndUpload = async (slot: typeof DOC_SLOTS[0]) => {
    if (!userId || loading || loadError || uploadLock.current || submitLock.current || kycStatus === 'approved') return;
    uploadLock.current = true;
    setUploading(slot.key);
    setActionError(null);
    setSubmitted(false);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') throw new Error('Allow photo access to upload documents.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.85 });
      if (result.canceled || !result.assets[0]) return;
      if (currentUser.current !== userId) return;
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, [{ resize: { width: 1200 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manipulated.base64) throw new Error('Could not read image');
      const storagePath = await uploadImage(manipulated.uri, environment.backendProvider === 'api' ? 'kyc-documents' : 'kyc-docs', { returnStorageRef: true });
      if (currentUser.current !== userId) return;
      if (environment.backendProvider === 'api') {
        await apiClient.post('/kyc/documents', { doc_type: slot.key, storage_path: storagePath }, { token: await getApiAccessToken() });
      } else {
        const { error: dbErr } = await backendDb.from('kyc_documents').upsert(
        { user_id: userId, doc_type: slot.key, storage_path: storagePath, status: 'pending' },
        { onConflict: 'user_id,doc_type' }
      );
        if (dbErr) throw dbErr;
      }
      if (currentUser.current === userId) setDocs(prev => ({ ...prev, [slot.key]: { uri: result.assets[0].uri, status: 'pending' } }));
    } catch (err: any) {
      if (currentUser.current === userId) setActionError(err.message || 'Upload failed. Please try again.');
    } finally { uploadLock.current = false; setUploading(null); }
  };

  const handleSubmit = async () => {
    if (!userId || loading || loadError || uploadLock.current || submitLock.current || kycStatus === 'approved') return;
    const missing = DOC_SLOTS.filter(s => s.required && !docs[s.key]);
    if (missing.length) { setActionError(`Please upload: ${missing.map(s => s.label).join(', ')}`); return; }
    submitLock.current = true;
    setSubmitting(true);
    setActionError(null);
    try {
      if (environment.backendProvider === 'api') {
        await apiClient.post('/kyc/submit', {}, { token: await getApiAccessToken() });
      } else {
        const { error } = await backendDb.from('profiles').update({ kyc_status: 'submitted' }).eq('id', userId);
        if (error) throw error;
      }
      if (currentUser.current !== userId) return;
      setSubmitted(true);
      setDocs(previous => Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, value ? { ...value, status: 'submitted' } : null])) as DocumentState);
      await revalidateSession().catch(() => null);
    } catch (err: any) {
      if (currentUser.current === userId) setActionError(err.message || 'Could not submit. Please try again.');
    } finally { submitLock.current = false; setSubmitting(false); }
  };

  const submitDisabled = loading || !!loadError || !!uploading || submitting || submitted || !userId || DOC_SLOTS.some(slot => slot.required && !docs[slot.key]);

  const statusBadge = (status?: string) => {
    if (!status) return null;
    const color = status === 'approved' ? '#22c55e' : status === 'rejected' ? '#ef4444' : '#f59e0b';
    const label = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending review';
    return <View style={[st.badge, { borderColor: color, backgroundColor: color + '18' }]}><Text style={[st.badgeText, { color }]}>{label}</Text></View>;
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={[st.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={[st.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={st.back}><Ionicons name="arrow-back" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={[st.title, { color: colors.text }]}>Identity Verification</Text>
        <Text style={[st.sub, { color: colors.textSecondary }]}>Identity verification is required for photographers and models. Documents are not displayed on your public profile.</Text>
        {loading && <ActivityIndicator accessibilityLabel="Loading identity documents" color={colors.accent} />}
        {loadError && <View><Text accessibilityRole="alert" style={{ color: colors.destructive }}>{loadError}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry identity documents" onPress={() => setLoadAttempt(attempt => attempt + 1)} style={st.uploadBtn}><Text style={{ color: colors.text }}>Retry</Text></TouchableOpacity></View>}
        {actionError && <Text accessibilityRole="alert" style={[st.sub, { color: colors.destructive }]}>{actionError}</Text>}
        {submitted && <Text accessibilityRole="alert" style={[st.sub, { color: colors.text }]}>Documents submitted for review.</Text>}

        {kycStatus === 'approved' && (
          <View style={[st.approvedBanner, { borderColor: '#22c55e', backgroundColor: '#22c55e18' }]}>
            <Ionicons name="shield-checkmark" size={20} color="#22c55e" />
            <Text style={[st.approvedText, { color: '#22c55e' }]}>Identity verified ✓</Text>
          </View>
        )}

        {DOC_SLOTS.map(slot => {
          const doc = docs[slot.key];
          const busy = uploading === slot.key;
          return (
            <View key={slot.key} style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={st.cardHead}>
                <View style={[st.icon, { backgroundColor: colors.bg }]}><Ionicons name={slot.icon as any} size={20} color={doc ? '#22c55e' : colors.textMuted} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[st.docLabel, { color: colors.text }]}>{slot.label}{slot.required && <Text style={{ color: '#ef4444' }}> *</Text>}</Text>
                  <Text style={[st.docHint, { color: colors.textSecondary }]}>{slot.hint}</Text>
                </View>
                {doc && statusBadge(doc.status)}
              </View>
              {doc && doc.uri !== 'uploaded' && <Image source={{ uri: doc.uri }} style={st.preview} resizeMode="cover" />}
              {doc && doc.uri === 'uploaded' && <View style={[st.uploadedRow, { backgroundColor: '#22c55e18' }]}><Ionicons name="checkmark-circle" size={16} color="#22c55e" /><Text style={{ color: '#22c55e', fontWeight: '600', fontSize: 13 }}>Document uploaded</Text></View>}
              <TouchableOpacity
                style={[st.uploadBtn, { borderColor: doc ? colors.border : '#c9a44a', backgroundColor: doc ? 'transparent' : '#c9a44a18' }]}
                onPress={() => pickAndUpload(slot)}
                accessibilityRole="button"
                accessibilityLabel={`${doc ? 'Replace' : 'Upload'} ${slot.label}`}
                disabled={loading || !!loadError || !!uploading || submitting || kycStatus === 'approved'}
              >
                {busy ? <ActivityIndicator size="small" color="#c9a44a" /> : (
                  <><Ionicons name={doc ? 'refresh' : 'cloud-upload-outline'} size={16} color={doc ? colors.textMuted : '#c9a44a'} />
                  <Text style={[st.uploadBtnText, { color: doc ? colors.textMuted : '#c9a44a' }]}>{doc ? 'Replace' : 'Upload'}</Text></>
                )}
              </TouchableOpacity>
            </View>
          );
        })}

        {kycStatus !== 'approved' && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Submit for Review" style={[st.submit, submitDisabled && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitDisabled}>
            {submitting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="send" size={18} color="#fff" /><Text style={st.submitText}>Submit for Review</Text></>}
          </TouchableOpacity>
        )}
        <Text style={[st.legal, { color: colors.textMuted }]}>By submitting, you confirm these documents are genuine and belong to you.</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

export default KYCScreen;

const st = StyleSheet.create({
  safe: { flex: 1 },
  container: { paddingHorizontal: 20, width: '100%', maxWidth: 760, alignSelf: 'center' },
  back: { marginBottom: 16, width: 44, height: 44, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 8 },
  sub: { fontSize: 14, lineHeight: 21, marginBottom: 24 },
  approvedBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 20 },
  approvedText: { fontWeight: '700', fontSize: 15 },
  card: { borderWidth: 1, borderRadius: 8, padding: 16, marginBottom: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  docLabel: { fontSize: 14, fontWeight: '700' },
  docHint: { fontSize: 12, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', maxWidth: 100 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  preview: { width: '100%', height: 130, borderRadius: 10, marginBottom: 10, backgroundColor: '#0f172a' },
  uploadedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, padding: 8, marginBottom: 10 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: 12, paddingVertical: 12 },
  uploadBtnText: { fontWeight: '700', fontSize: 13 },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#c9a44a', borderRadius: 16, paddingVertical: 16, marginTop: 8, marginBottom: 16 },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  legal: { fontSize: 11, textAlign: 'center', lineHeight: 16 },
});
