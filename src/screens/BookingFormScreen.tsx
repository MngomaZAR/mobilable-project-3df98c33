import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { BookingCalendar } from '../components/BookingCalendar';

type Route = RouteProp<RootStackParamList, 'BookingForm'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingForm'>;

const BookingFormScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, createBooking } = useAppData();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [timeSlot, setTimeSlot] = useState('Golden hour (4-7)');
  const [packageType, setPackageType] = useState('Half-day coverage');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const photographer = useMemo(
    () => state.photographers.find((item) => item.id === params.photographerId),
    [params.photographerId, state.photographers]
  );

  if (!photographer) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This photographer is no longer available.</Text>
      </View>
    );
  }

  const formattedDate = useMemo(() => {
    if (!selectedDate) return 'Pick a date and time slot below';
    return `${selectedDate.toDateString()} · ${timeSlot}`;
  }, [selectedDate, timeSlot]);

  const handleSubmit = async () => {
    if (!selectedDate) {
      Alert.alert('Date required', 'Please add a shoot date.');
      return;
    }

    try {
      setSubmitting(true);
      const normalizedDate = new Date(selectedDate);
      normalizedDate.setUTCHours(12, 0, 0, 0);
      const bookingDate = `${normalizedDate.toISOString()} | ${timeSlot}`;
      const booking = await createBooking({
        photographerId: photographer.id,
        date: bookingDate,
        package: packageType,
        notes,
      });
      Alert.alert('Request sent', 'Your booking was saved locally and is ready to review.', [
        {
          text: 'View booking',
          onPress: () => navigation.replace('BookingDetail', { bookingId: booking.id }),
        },
      ]);
    } catch (err) {
      Alert.alert('Unable to save', 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Photographer</Text>
      <Text style={styles.value}>{photographer.name}</Text>

      <Text style={styles.label}>Preferred date</Text>
      <View style={styles.selectedDate}>
        <Text style={styles.selectedDateText}>{formattedDate}</Text>
      </View>
      <BookingCalendar value={selectedDate} onChange={setSelectedDate} timeSlot={timeSlot} onTimeChange={setTimeSlot} />

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

      <TouchableOpacity style={styles.cta} onPress={handleSubmit} disabled={submitting}>
        <Text style={styles.ctaText}>{submitting ? 'Saving...' : 'Send request'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f7f7fb',
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
});

export default BookingFormScreen;
