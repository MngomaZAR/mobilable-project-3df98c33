import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../store/ThemeContext';
import { backendDb } from '../services/backendGateway';
import { useAuth } from '../store/AuthContext';
import { useAppData } from '../store/AppDataContext';
import { recordConsent as recordComplianceConsent } from '../services/dispatchService';
import { BRAND } from '../utils/constants';
import { roleRequiresKyc } from '../utils/userRole';
import { environment } from '../config/environment';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';

const AgeVerificationScreen: React.FC = () => {
  const { colors } = useTheme();
  const { currentUser, revalidateSession } = useAuth();
  const { setState } = useAppData();
  const [dob, setDob] = useState(new Date(2000, 0, 1));
  const [showPicker, setShowPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [webDob, setWebDob] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!currentUser?.id) {
      Alert.alert('Session Error', 'Please sign in again to continue age verification.');
      return;
    }

    const selected = Platform.OS === 'web' ? new Date(`${webDob}T12:00:00Z`) : dob;
    if (Number.isNaN(selected.getTime())) { setFailure('Enter your date of birth as YYYY-MM-DD.'); return; }
    const today = new Date();
    const age = today.getFullYear() - selected.getFullYear() -
      (today < new Date(today.getFullYear(), selected.getMonth(), selected.getDate()) ? 1 : 0);

    if (age < 18) {
      Alert.alert(
        'Age Requirement',
        `You must be 18 or older to use ${BRAND.name}.`,
        [{ text: 'OK' }]
      );
      return;
    }

    setSubmitting(true);
    setFailure(null);
    try {
      const isoDob = Platform.OS === 'web' ? webDob : `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`;
      const requiresKyc = roleRequiresKyc(currentUser);
      if (environment.backendProvider === 'api') {
        const result = await apiClient.post<{ profile: { age_verified: boolean; age_verified_at: string } }>('/auth/age-confirm', {
          date_of_birth: isoDob, accepted_terms: true,
        }, { token: await getApiAccessToken() });
        setState({ currentUser: { ...currentUser, ...result.profile } });
        await revalidateSession();
        return;
      }

      // Consent logging should never block age-gate progression if the edge function is unavailable.
      try {
        await recordComplianceConsent({
          consent_type: 'terms',
          enabled: true,
          legal_basis: 'consent',
          consent_version: '1.0',
          context: { age_verified: true, dob: isoDob },
        });
      } catch (consentErr) {
        console.warn('Consent logging failed during age verification:', consentErr);
      }

      const nowIso = new Date().toISOString();
      const profilePayload: Record<string, unknown> = {
        id: currentUser.id,
        date_of_birth: isoDob,
        age_verified: true,
        age_verified_at: nowIso,
        ...(requiresKyc ? { kyc_status: 'pending' } : {}),
      };
      if (currentUser.role) {
        profilePayload.role = currentUser.role;
      }

      // Use upsert so users without a pre-created profile row cannot get stuck.
      const { error } = await backendDb
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'id' });
      if (error) throw error;

      if (requiresKyc) {
        // Create moderation queue item once so retries do not duplicate open tickets.
        const { data: existingCase, error: existingCaseErr } = await backendDb
          .from('moderation_cases')
          .select('id')
          .eq('target_user_id', currentUser.id)
          .eq('target_type', 'profile')
          .eq('reason', 'KYC verification review required')
          .in('status', ['open', 'in_review'])
          .maybeSingle();
        if (existingCaseErr) throw existingCaseErr;

        if (!existingCase?.id) {
          const { error: insertCaseErr } = await backendDb.from('moderation_cases').insert({
            reporter_id: currentUser.id,
            target_user_id: currentUser.id,
            target_type: 'profile',
            target_id: currentUser.id,
            reason: 'KYC verification review required',
            severity: 2,
            status: 'open',
          });
          if (insertCaseErr) throw insertCaseErr;
        }
      }

      // Optimistic local state update so user is never trapped on this screen
      setState({
        currentUser: {
          ...currentUser,
          age_verified: true,
          age_verified_at: nowIso,
          date_of_birth: isoDob,
          ...(requiresKyc ? { kyc_status: 'pending' } : {}),
        },
      });
      await revalidateSession();
    } catch (err) {
      console.error('Age verification error:', err);
      setFailure(err instanceof Error ? err.message : 'Could not save your age declaration.');
      Alert.alert('Verification Failed', 'Could not complete age verification right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>Age Verification</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          You must be 18 or older to use {BRAND.name}. Identity review is required before offering paid services.
        </Text>

        {Platform.OS === 'web' ? <TextInput placeholder="Date of birth (YYYY-MM-DD)" value={webDob} onChangeText={setWebDob} style={[styles.dateBtn, { borderColor: colors.border, color: colors.text }]} /> : <TouchableOpacity
          style={[styles.dateBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={() => setShowPicker(true)}
        >
          <Text style={[styles.dateText, { color: colors.text }]}>
            Date of birth: {dob.toLocaleDateString('en-ZA')}
          </Text>
        </TouchableOpacity>}

        {showPicker && Platform.OS !== 'web' && (
          <DateTimePicker
            value={dob}
            mode="date"
            maximumDate={new Date()}
            minimumDate={new Date(1900, 0, 1)}
            onChange={(_event: unknown, date?: Date) => {
              setShowPicker(Platform.OS === 'ios');
              if (date) setDob(date);
            }}
          />
        )}

        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: colors.accent, opacity: submitting ? 0.7 : 1 }]}
          onPress={handleConfirm}
          disabled={submitting}
        >
          <Text style={styles.confirmText}>
            {submitting ? 'Verifying...' : 'I confirm I am 18+'}
          </Text>
        </TouchableOpacity>
        {failure ? <Text accessibilityRole="alert" style={{ color: colors.destructive, marginTop: 12 }}>{failure}</Text> : null}

        <Text style={[styles.legal, { color: colors.textMuted }]}>
          By continuing you agree to our Terms of Service and confirm you are at least 18 years old.
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', marginBottom: 12 },
  subtitle: { fontSize: 16, lineHeight: 24, marginBottom: 32 },
  dateBtn: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 16 },
  dateText: { fontSize: 16, fontWeight: '600' },
  confirmBtn: { borderRadius: 16, padding: 18, alignItems: 'center', marginTop: 8 },
  confirmText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  legal: { fontSize: 12, textAlign: 'center', marginTop: 24, lineHeight: 18 },
});

export default AgeVerificationScreen;
