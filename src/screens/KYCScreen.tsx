import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../config/supabaseClient';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { RootStackParamList } from '../navigation/types';

type DocType = 'id_book' | 'passport' | 'drivers_license' | 'selfie' | 'proof_of_address';
type Nav = StackNavigationProp<RootStackParamList>;

const DOC_SLOTS = [
  { key: 'id_book' as DocType,          label: 'SA ID / Passport',   icon: 'card-outline',   hint: 'Clear photo of your green ID book or passport', required: true  },
  { key: 'selfie' as DocType,           label: 'Selfie with ID',     icon: 'person-outline', hint: 'Hold your ID next to your face in good light',   required: true  },
  { key: 'proof_of_address' as DocType, label: 'Proof of Address',   icon: 'home-outline',   hint: 'Utility bill or bank statement under 3 months',  required: false },
];

const KYCScreen: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { state } = useAppData();
  const userId = state.currentUser?.id;
  const kycStatus = state.currentUser?.kyc_status;

  const [docs, setDocs] = useState<Record<DocType, { uri: string; status: string } | null>>({
    id_book: null, passport: null, drivers_license: null, selfie: null, proof_of_address: null,
  });
  const [uploading, setUploading] = useState<DocType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!userId) return;
    supabase.from('kyc_documents').select('doc_type, status').eq('user_id', userId)
      .then(({ data }) => {
        if (!data) return;
        const updates: typeof docs = { ...docs };
        data.forEach((r: any) => { updates[r.doc_type as DocType] = { uri: 'uploaded', status: r.status }; });
        setDocs(updates);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const pickAndUpload = async (slot: typeof DOC_SLOTS[0]) => {
    if (!userId) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo access to upload documents.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;

    setUploading(slot.key);
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, [{ resize: { width: 1200 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manipulated.base64) throw new Error('Could not read image');
      const path = `${userId}/${slot.key}_${Date.now()}.jpg`;
      const { error: storageErr } = await supabase.storage.from('kyc-docs')
        .upload(path, decode(manipulated.base64), { contentType: 'image/jpeg', upsert: true });
      if (storageErr) throw storageErr;
      const { error: dbErr } = await supabase.from('kyc_documents').upsert(
        { user_id: userId, doc_type: slot.key, storage_path: path, status: 'pending' },
        { onConflict: 'user_id,doc_type' }
      );
      if (dbErr) throw dbErr;
      setDocs(prev => ({ ...prev, [slot.key]: { uri: result.assets[0].uri, status: 'pending' } }));
    } catch (err: any) {
      Alert.alert('Upload failed', err.message || 'Please try again.');
    } finally { setUploading(null); }
  };

  const handleSubmit = async () => {
    const missing = DOC_SLOTS.filter(s => s.required && !docs[s.key]);
    if (missing.length) { Alert.alert('Missing documents', `Please upload: ${missing.map(s => s.label).join(', ')}`); return; }
    setSubmitting(true);
    try {
      await supabase.from('profiles').update({ kyc_status: 'submitted' }).eq('id', userId);
      Alert.alert('Submitted!', 'Documents sent for review. We usually respond within 24 hours.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not submit. Please try again.');
    } finally { setSubmitting(false); }
  };

  const statusBadge = (status?: string) => {
    if (!status) return null;
    const color = status === 'approved' ? '#22c55e' : status === 'rejected' ? '#ef4444' : '#f59e0b';
    const label = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending review';
    return <View style={[st.badge, { borderColor: color, backgroundColor: color + '18' }]}><Text style={[st.badgeText, { color }]}>{label}</Text></View>;
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={[st.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={[st.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.back}><Ionicons name="arrow-back" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={[st.title, { color: colors.text }]}>Identity Verification</Text>
        <Text style={[st.sub, { color: colors.textSecondary }]}>Documents are reviewed by our team only and stored encrypted. Required for all photographers and models.</Text>

        {kycStatus === 'approved' && (
          <View style={[st.approvedBanner, { borderColor: '#22c55e', backgroundColor: '#22c55e18' }]}>
            <Ionicons name="shield-checkmark" size={20} color="#22c55e" />
            <Text style={[st.approvedText, { color: '#22c55e' }]}>Identity verified âœ“</Text>
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
                disabled={busy || kycStatus === 'approved'}
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
          <TouchableOpacity style={[st.submit, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="send" size={18} color="#fff" /><Text style={st.submitText}>Submit for Review</Text></>}
          </TouchableOpacity>
        )}
        <Text style={[st.legal, { color: colors.textMuted }]}>By submitting you confirm these are genuine documents. False submissions may result in permanent suspension under POPIA.</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

export default KYCScreen;

const st = StyleSheet.create({
  safe: { flex: 1 },
  container: { paddingHorizontal: 20 },
  back: { marginBottom: 16, width: 36 },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 8 },
  sub: { fontSize: 14, lineHeight: 21, marginBottom: 24 },
  approvedBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 20 },
  approvedText: { fontWeight: '700', fontSize: 15 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  docLabel: { fontSize: 14, fontWeight: '700' },
  docHint: { fontSize: 12, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  preview: { width: '100%', height: 130, borderRadius: 10, marginBottom: 10, backgroundColor: '#0f172a' },
  uploadedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, padding: 8, marginBottom: 10 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: 12, paddingVertical: 12 },
  uploadBtnText: { fontWeight: '700', fontSize: 13 },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#c9a44a', borderRadius: 16, paddingVertical: 16, marginTop: 8, marginBottom: 16 },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  legal: { fontSize: 11, textAlign: 'center', lineHeight: 16 },
});
