import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { BookingStatus } from '../types';

type Route = RouteProp<RootStackParamList, 'BookingDetail'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingDetail'>;

const steps: BookingStatus[] = ['pending', 'accepted', 'completed', 'reviewed'];

const BookingDetailScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, updateBookingStatus } = useAppData();
  const [updating, setUpdating] = useState(false);

  const booking = useMemo(
    () => state.bookings.find((item) => item.id === params.bookingId),
    [params.bookingId, state.bookings]
  );
  const photographer = useMemo(
    () => state.photographers.find((p) => p.id === booking?.photographerId),
    [booking?.photographerId, state.photographers]
  );

  if (!booking) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>We could not find that booking.</Text>
      </View>
    );
  }

  const advanceStatus = async () => {
    if (booking.status === 'reviewed') return;
    setUpdating(true);
    await updateBookingStatus(booking.id);
    setUpdating(false);
    Alert.alert('Status updated', 'Booking moved to the next state locally.');
  };

  const currentIndex = steps.indexOf(booking.status);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{booking.package}</Text>
      <Text style={styles.meta}>With {photographer?.name ?? 'your photographer'}</Text>
      <Text style={styles.meta}>Date: {booking.date}</Text>
      {booking.notes ? <Text style={styles.notes}>{booking.notes}</Text> : null}

      <View style={styles.timeline}>
        {steps.map((step, index) => {
          const active = index <= currentIndex;
          return (
            <View key={step} style={styles.stepRow}>
              <View style={[styles.stepDot, active && styles.stepDotActive]} />
              <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{step}</Text>
            </View>
          );
        })}
      </View>

      <TouchableOpacity
        style={[styles.cta, booking.status === 'reviewed' && styles.ctaDisabled]}
        onPress={advanceStatus}
        disabled={booking.status === 'reviewed' || updating}
      >
        <Text style={styles.ctaText}>
          {booking.status === 'reviewed' ? 'Review complete' : updating ? 'Updating...' : 'Advance status'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondary}
        onPress={() => navigation.navigate('Root', { screen: 'Chat' })}
      >
        <Text style={styles.secondaryText}>Open chat</Text>
      </TouchableOpacity>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.secondary, styles.rowButton]}
          onPress={() => navigation.navigate('BookingTracking', { bookingId: booking.id })}
        >
          <Text style={styles.secondaryText}>Track on map</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondary, styles.rowButton]}
          onPress={() => navigation.navigate('Payment', { bookingId: booking.id })}
        >
          <Text style={styles.secondaryText}>Payments</Text>
        </TouchableOpacity>
      </View>
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
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  meta: {
    color: '#475569',
    marginTop: 4,
  },
  notes: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
    color: '#0f172a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  timeline: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
    marginRight: 10,
  },
  stepDotActive: {
    backgroundColor: '#0f172a',
  },
  stepLabel: {
    textTransform: 'capitalize',
    color: '#6b7280',
    fontWeight: '600',
  },
  stepLabelActive: {
    color: '#0f172a',
  },
  cta: {
    marginTop: 16,
    backgroundColor: '#0f172a',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  ctaDisabled: {
    backgroundColor: '#9ca3af',
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    marginTop: 10,
  },
  rowButton: {
    flex: 1,
    marginRight: 8,
  },
  secondary: {
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#e5e7eb',
  },
  secondaryText: {
    color: '#111827',
    fontWeight: '700',
  },
});

export default BookingDetailScreen;
