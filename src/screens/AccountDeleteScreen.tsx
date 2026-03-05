import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useAppData } from '../store/AppDataContext';

const AccountDeleteScreen: React.FC = () => {
  const { requestDataDeletion, currentUser } = useAppData();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitRequest = async () => {
    if (!currentUser?.id) {
      Alert.alert('Sign in required', 'Please sign in to request account deletion.');
      return;
    }
    setSubmitting(true);
    try {
      await requestDataDeletion(reason.trim() || undefined);
      Alert.alert('Request sent', 'Your account deletion request was submitted.');
      setReason('');
    } catch (err: any) {
      Alert.alert('Unable to submit', err?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Account deletion</Text>
      <Text style={styles.subtitle}>
        We will process deletion requests and confirm once complete. You can add optional details below.
      </Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        style={[styles.input, styles.multiline]}
        placeholder="Reason (optional)"
        multiline
      />
      <TouchableOpacity style={styles.danger} onPress={submitRequest} disabled={submitting}>
        <Text style={styles.dangerText}>{submitting ? 'Submitting...' : 'Submit deletion request'}</Text>
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
    marginBottom: 6,
  },
  subtitle: {
    color: '#475569',
    marginBottom: 12,
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
  danger: {
    marginTop: 12,
    backgroundColor: '#991b1b',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  dangerText: {
    color: '#fff',
    fontWeight: '700',
  },
});

export default AccountDeleteScreen;
