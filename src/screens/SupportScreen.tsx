import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppData } from '../store/AppDataContext';
import { supabase } from '../config/supabaseClient';

const CATEGORIES = ['general', 'payment', 'booking', 'technical', 'safety'] as const;

const SupportScreen: React.FC = () => {
  const { currentUser, trackEvent } = useAppData();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('general');
  const [submitting, setSubmitting] = useState(false);

  const submitTicket = async () => {
    if (!subject.trim() || !description.trim()) {
      Alert.alert('Missing details', 'Please add a subject and description.');
      return;
    }
    if (!currentUser?.id) {
      Alert.alert('Sign in required', 'Please sign in to submit a support request.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('support_tickets').insert({
        created_by: currentUser.id,
        subject: subject.trim(),
        category,
        description: description.trim(),
      });
      if (error) throw error;
      await trackEvent('support_ticket_created', { category });
      setSubject('');
      setDescription('');
      Alert.alert('Request sent', 'Support has received your ticket.');
    } catch (err: any) {
      Alert.alert('Unable to submit', err?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Support</Text>
      <Text style={styles.subtitle}>Tell us what you need help with.</Text>

      <Text style={styles.label}>Category</Text>
      <View style={styles.categoryRow}>
        {CATEGORIES.map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.categoryChip, category === item && styles.categoryChipActive]}
            onPress={() => setCategory(item)}
          >
            <Text style={[styles.categoryText, category === item && styles.categoryTextActive]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Subject</Text>
      <TextInput value={subject} onChangeText={setSubject} style={styles.input} placeholder="Short summary" />

      <Text style={styles.label}>Description</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        style={[styles.input, styles.multiline]}
        placeholder="Describe the issue or request"
        multiline
      />

      <TouchableOpacity style={styles.primary} onPress={submitTicket} disabled={submitting}>
        <Text style={styles.primaryText}>{submitting ? 'Sending...' : 'Submit ticket'}</Text>
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
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  categoryChipActive: {
    backgroundColor: '#0f172a',
  },
  categoryText: {
    fontWeight: '700',
    color: '#0f172a',
  },
  categoryTextActive: {
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

export default SupportScreen;
