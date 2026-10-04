import React, { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../store/ThemeContext';
import { submitSupportTicket, SupportTicketPayload } from '../services/supportService';
import { BRAND } from '../utils/constants';

type Navigation = StackNavigationProp<RootStackParamList, 'Support'>;

const CATEGORIES: { label: string; value: SupportTicketPayload['category']; icon: string }[] = [
  { label: 'General enquiry', value: 'general', icon: 'help-circle-outline' },
  { label: 'Billing & payments', value: 'billing', icon: 'card-outline' },
  { label: 'Safety & trust', value: 'safety', icon: 'shield-outline' },
  { label: 'Technical issue', value: 'technical', icon: 'bug-outline' },
  { label: 'My account', value: 'account', icon: 'person-outline' },
];

const SupportScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Support'>>();
  const [category, setCategory] = useState<SupportTicketPayload['category']>(params?.category ?? 'general');
  const [subject, setSubject] = useState(params?.subject ?? '');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketReference, setTicketReference] = useState<string | null>(null);
  const pending = useRef(false);

  const handleSubmit = async () => {
    if (pending.current || ticketReference) return;
    if (!subject.trim() || !description.trim()) {
      setError('Please fill in both the subject and description.');
      Alert.alert('Missing fields', 'Please fill in both the subject and description.');
      return;
    }
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const details = params?.bookingId ? `Booking reference: ${params.bookingId}\n\n${description.trim()}` : description.trim();
      const ticket = await submitSupportTicket({ subject: subject.trim(), category, description: details });
      if (!ticket?.id) throw new Error('Support did not return a ticket reference. Please refresh before retrying.');
      setTicketReference(ticket.id);
      Alert.alert('Ticket submitted', `Reference: ${ticket.id}`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      setError(e.message || 'Failed to submit ticket. Please try again.');
      Alert.alert('Error', e.message || 'Failed to submit ticket. Please try again.');
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Contact Support</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {params?.bookingId ? <Text selectable style={{ color: colors.textSecondary }}>Booking reference: {params.bookingId}</Text> : null}
          {/* Category picker */}
          <Text style={[styles.label, { color: colors.text }]}>Category</Text>
          <View style={styles.categories}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                style={[
                  styles.catBtn,
                  { borderColor: category === cat.value ? colors.accent : colors.border },
                  category === cat.value && { backgroundColor: colors.accent + '18' },
                ]}
                onPress={() => setCategory(cat.value)}
              >
                <Ionicons name={cat.icon as any} size={16} color={category === cat.value ? colors.accent : colors.textMuted} />
                <Text style={[styles.catTxt, { color: category === cat.value ? colors.accent : colors.text }]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Subject */}
          <Text style={[styles.label, { color: colors.text }]}>Subject</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            placeholder="Brief summary of your issue"
            placeholderTextColor={colors.textMuted}
            value={subject}
            onChangeText={setSubject}
            maxLength={100}
            accessibilityLabel="Support subject"
          />

          {/* Description */}
          <Text style={[styles.label, { color: colors.text }]}>Description</Text>
          <TextInput
            style={[styles.input, styles.textarea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            placeholder="Please describe your issue in detail..."
            placeholderTextColor={colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            maxLength={2000}
            accessibilityLabel="Support description"
          />

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.accent }, (submitting || !!ticketReference) && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={submitting || !!ticketReference}
            accessibilityRole="button"
            accessibilityLabel="Submit ticket"
            accessibilityState={{ disabled: submitting || !!ticketReference, busy: submitting }}
          >
            <Ionicons name="send-outline" size={18} color="#fff" />
            <Text style={styles.submitTxt}>{submitting ? 'Sending…' : 'Submit ticket'}</Text>
          </TouchableOpacity>
          {error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
          {ticketReference && <Text selectable accessibilityRole="alert" style={{ color: colors.text }}>Ticket submitted. Reference: {ticketReference}</Text>}

          <Text style={[styles.note, { color: colors.textMuted }]}>
            {BRAND.email.support}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  content: { padding: 20, gap: 8, paddingBottom: 60 },
  label: { fontWeight: '700', fontSize: 14, marginTop: 12, marginBottom: 6 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  catTxt: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  textarea: { minHeight: 120, paddingTop: 12 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 14, gap: 8, marginTop: 16 },
  submitTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
  note: { fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },
});

export default SupportScreen;
