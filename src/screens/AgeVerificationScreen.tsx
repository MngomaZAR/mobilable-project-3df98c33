import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../store/ThemeContext';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../store/AuthContext';
import { recordConsent as recordComplianceConsent } from '../services/dispatchService';

const AgeVerificationScreen: React.FC = () => {
  const { colors } = useTheme();
  const { currentUser, revalidateSession } = useAuth();
  const [dob, setDob] = useState(new Date(2000, 0, 1));
  const [showPicker, setShowPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!currentUser?.id) {
      Alert.alert('Session Error', 'Please sign in again to continue age verification.');
      return;
    }

    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear() -
      (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);

    if (age < 18) {
      Alert.alert(
        'Age Requirement',
        'You must be 18 or older to use Papzi.',
        [{ text: 'OK' }]
      );
      return;
    }

    setSubmitting(true);
    try {
      const isoDob = dob.toISOString().split('T')[0];
      const requiresKyc = currentUser?.role === 'photographer' || currentUser?.role === 'model';

      // Record consent with DOB proof using compliance event + immutable audit
      await recordComplianceConsent({
        consent_type: 'terms',
        enabled: true,
        legal_basis: 'consent',
        consent_version: '1.0',
        context: { age_verified: true, dob: isoDob },
      });

      const { error } = await supabase.from('profiles')
        .update({
          date_of_birth: isoDob,
          age_verified: true,
          age_verified_at: new Date().toISOString(),
          ...(requiresKyc ? { kyc_status: 'pending' } : {}),
        })
        .eq('id', currentUser.id);
      if (error) throw error;

      if (requiresKyc) {
        // Create moderation queue item once so retries do not duplicate open tickets.
        const { data: existingCase, error: existingCaseErr } = await supabase
          .from('moderation_cases')
          .select('id')
          .eq('target_user_id', currentUser.id)
          .eq('target_type', 'profile')
          .eq('reason', 'KYC verification review required')
          .in('status', ['open', 'in_review'])
          .maybeSingle();
        if (existingCaseErr) throw existingCaseErr;

        if (!existingCase?.id) {
          const { error: insertCaseErr } = await supabase.from('moderation_cases').insert({
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

      await revalidateSession();
    } catch (err) {
      console.error('Age verification error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>Age Verification</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Papzi contains adult-oriented content. You must be 18 or older to continue.
        </Text>

        <TouchableOpacity
          style={[styles.dateBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={() => setShowPicker(true)}
        >
          <Text style={[styles.dateText, { color: colors.text }]}>
            Date of birth: {dob.toLocaleDateString('en-ZA')}
          </Text>
        </TouchableOpacity>

        {showPicker && (
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
