import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { supabase } from '../config/supabaseClient';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';

type Route = RouteProp<RootStackParamList, 'Report'>;

const REASONS = ['spam', 'harassment', 'fraud', 'impersonation', 'other'] as const;

const ReportScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const { currentUser, trackEvent } = useAppData();
  const [reason, setReason] = useState<(typeof REASONS)[number]>('spam');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitReport = async () => {
    if (!currentUser?.id) {
      Alert.alert('Sign in required', 'Please sign in to submit a report.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('reports').insert({
        created_by: currentUser.id,
        target_type: params.targetType,
        target_id: params.targetId,
        reason,
        details: details.trim() || null,
      });
      if (error) throw error;
      await trackEvent('report_submitted', { targetType: params.targetType });
      setDetails('');
      Alert.alert('Report submitted', 'Thanks for helping keep Papzi safe.');
    } catch (err: any) {
      Alert.alert('Unable to submit', err?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Report</Text>
      <Text style={styles.subtitle}>
        Reporting {params.targetType === 'post' ? 'a post' : 'a user'} · {params.title ?? params.targetId}
      </Text>

      <Text style={styles.label}>Reason</Text>
      <View style={styles.reasonRow}>
        {REASONS.map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.reasonChip, reason === item && styles.reasonChipActive]}
            onPress={() => setReason(item)}
          >
            <Text style={[styles.reasonText, reason === item && styles.reasonTextActive]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Details (optional)</Text>
      <TextInput
        value={details}
        onChangeText={setDetails}
        style={[styles.input, styles.multiline]}
        placeholder="Tell us what happened"
        multiline
      />

      <TouchableOpacity style={styles.primary} onPress={submitReport} disabled={submitting}>
        <Text style={styles.primaryText}>{submitting ? 'Submitting...' : 'Submit report'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f7f7fb',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    color: '#475569',
    marginTop: 4,
    marginBottom: 12,
  },
  label: {
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  multiline: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reasonChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  reasonChipActive: {
    backgroundColor: '#0f172a',
  },
  reasonText: {
    fontWeight: '700',
    color: '#0f172a',
  },
  reasonTextActive: {
    color: '#fff',
  },
  primary: {
    marginTop: 16,
    backgroundColor: '#0f172a',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
  },
});

export default ReportScreen;
