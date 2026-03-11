import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useMessaging } from '../store/MessagingContext';
import { BookingCalendar } from '../components/BookingCalendar';
import { Ionicons } from '@expo/vector-icons';

type Route = RouteProp<RootStackParamList, 'BookingForm'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingForm'>;

const BookingFormScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, createBooking } = useAppData();
  const { startConversationWithUser } = useMessaging();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [timeSlot, setTimeSlot] = useState('Golden hour (4-7)');
  const [packageType, setPackageType] = useState('Half-day coverage');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const talent = useMemo(
    () => state.photographers.find((item) => item.id === params.photographerId) || 
          state.models.find((item) => item.id === params.photographerId),
    [params.photographerId, state.photographers, state.models]
  );

  if (!talent) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This talent is no longer available.</Text>
      </View>
    );
  }

  const formattedDate = useMemo(() => {
    if (!selectedDate) return 'Pick a date and time slot below';
    return `${selectedDate.toDateString()} · ${timeSlot}`;
  }, [selectedDate, timeSlot]);

  /** Base rate in ZAR derived from price-tier (number of $ signs) */
  const estimatedBaseAmount = useMemo(() => {
    const level = ((talent?.price_range || '').match(/\$/g) || []).length || 2;
    return level * 1200;
  }, [talent.price_range]);

  const estimatedRate = `From R${estimatedBaseAmount.toLocaleString('en-ZA')}`;
  const commissionAmount = Math.round(estimatedBaseAmount * 0.30);
  const photographerPayout = estimatedBaseAmount - commissionAmount;

  const handleSubmit = async () => {
    if (!selectedDate) {
      Alert.alert('Date required', 'Please add a shoot date.');
      return;
    }

    try {
      setSubmitting(true);
      // Store booking_date as clean ISO date (YYYY-MM-DD) — Postgres date column compatible
      const normalizedDate = new Date(selectedDate);
      normalizedDate.setUTCHours(12, 0, 0, 0);
      const bookingDate = normalizedDate.toISOString().split('T')[0]; // e.g. '2026-03-15'
      const booking = await createBooking({
        talent_id: talent.id,
        booking_date: bookingDate,
        package_type: `${packageType} · ${timeSlot}`,
        notes,
        base_amount: estimatedBaseAmount,
        travel_amount: 0,
      });
      Alert.alert('Request sent', 'Your booking request was submitted and is ready to review.', [
        {
          text: 'View booking',
          onPress: () => navigation.replace('BookingDetail', { bookingId: booking.id }),
        },
      ]);
    } catch (err: any) {
      Alert.alert('Unable to save', err?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMessage = async () => {
    try {
      const convo = await startConversationWithUser(talent.id, talent.name);
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch (e) {
      Alert.alert('Error', 'Unable to start chat.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>Book {talent.name}</Text>
        <Text style={styles.heroMeta}>{talent.style} · {talent.location}</Text>
        <View style={styles.heroFooter}>
          <Text style={styles.heroPrice}>{estimatedRate}</Text>
          <TouchableOpacity style={styles.msgBadge} onPress={handleMessage}>
            <Ionicons name="chatbubble-outline" size={16} color="#fbbf24" />
            <Text style={styles.msgBadgeText}>Message</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.label}>Talent</Text>
      <Text style={styles.value}>{talent.name}</Text>

      <Text style={styles.label}>Preferred date</Text>
      <View style={styles.selectedDate}>
        <Text style={styles.selectedDateText}>{formattedDate}</Text>
      </View>
      <BookingCalendar value={selectedDate} onChange={setSelectedDate} timeSlot={timeSlot} onTimeChange={setTimeSlot} />

      <View style={styles.detailsCard}>
        <Text style={styles.label}>Package</Text>
        <TextInput
          placeholder="Half-day coverage"
          value={packageType}
          onChangeText={setPackageType}
          style={styles.input}
        />

        <Text style={styles.label}>Notes</Text>
        <TextInput
          placeholder="Shot list, vibe, must-have moments"
          value={notes}
          onChangeText={setNotes}
          style={[styles.input, styles.multiline]}
          multiline
          numberOfLines={4}
        />
      </View>

      {/* Price Breakdown */}
      <View style={styles.breakdownCard}>
        <Text style={styles.breakdownTitle}>Estimated Cost</Text>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Session rate</Text>
          <Text style={styles.breakdownValue}>R{estimatedBaseAmount.toLocaleString('en-ZA')}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Platform fee (30%)</Text>
          <Text style={[styles.breakdownValue, { color: '#ef4444' }]}>−R{commissionAmount.toLocaleString('en-ZA')}</Text>
        </View>
        <View style={[styles.breakdownRow, styles.breakdownTotal]}>
          <Text style={[styles.breakdownLabel, { fontWeight: '800', color: '#0f172a' }]}>Talent payout</Text>
          <Text style={[styles.breakdownValue, { color: '#16a34a', fontWeight: '800' }]}>R{photographerPayout.toLocaleString('en-ZA')}</Text>
        </View>
        <Text style={styles.breakdownNote}>* Exact total calculated at checkout based on final scope</Text>
      </View>

      <TouchableOpacity
        style={[styles.cta, submitting && { opacity: 0.7 }]}
        onPress={handleSubmit}
        disabled={submitting}
        activeOpacity={submitting ? 1 : 0.8}
      >
        <Text style={styles.ctaText}>{submitting ? 'Saving...' : 'Send request'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 120,
    backgroundColor: '#f7f7fb',
  },
  heroCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  heroMeta: {
    color: '#cbd5e1',
    marginTop: 4,
  },
  heroPrice: {
    color: '#fbbf24',
    fontWeight: '800',
  },
  heroFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  msgBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  msgBadgeText: {
    color: '#fbbf24',
    fontWeight: '700',
    fontSize: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  muted: {
    color: '#475569',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
    marginTop: 10,
  },
  value: {
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    color: '#0f172a',
    fontWeight: '700',
  },
  selectedDate: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    marginBottom: 10,
  },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    padding: 12,
    marginTop: 10,
  },
  selectedDateText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  multiline: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  cta: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  breakdownCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    padding: 14,
    marginTop: 14,
    gap: 8,
  },
  breakdownTitle: {
    fontWeight: '800',
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 4,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownTotal: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    marginTop: 4,
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#475569',
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  breakdownNote: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 4,
  },
});

export default BookingFormScreen;

