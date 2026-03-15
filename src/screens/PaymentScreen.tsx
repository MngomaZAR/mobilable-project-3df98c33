import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { PaymentWebView } from '../components/PaymentWebView';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { createPayfastCheckoutLink } from '../services/paymentService';

type Route = RouteProp<RootStackParamList, 'Payment'>;
type Navigation = StackNavigationProp<RootStackParamList, 'Payment'>;

const PaymentScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state } = useAppData();
  const booking = useMemo(
    () => (params?.bookingId ? state.bookings.find((item) => item.id === params.bookingId) : undefined),
    [params?.bookingId, state.bookings]
  );
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Create a signed link to start PayFast checkout.');
  const [loadingLink, setLoadingLink] = useState(false);

  const bookingId = params?.bookingId;
  const checkoutItemName = booking?.package_type ?? 'Photography booking';
  const checkoutAmount = booking?.total_amount ? `R${booking.total_amount.toLocaleString()}` : 'R1,200';

  const handleSuccess = () => {
    setStatusMessage('Payment completed. Waiting for secure confirmation...');
    Alert.alert('Payment received', 'Checkout completed. Your booking status will update after confirmation.');
  };

  const handleError = (message: string) => {
    setStatusMessage(message);
  };

  const supabaseBaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? null;
  const returnUrl = supabaseBaseUrl ? `${supabaseBaseUrl}/payfast/return` : null;
  const cancelUrl = supabaseBaseUrl ? `${supabaseBaseUrl}/payfast/cancel` : null;
  const notifyUrl = supabaseBaseUrl ? `${supabaseBaseUrl}/functions/v1/payfast-itn` : null;

  useEffect(() => {
    if (booking?.booking_date) {
      setStatusMessage(`Payment requested for ${booking.booking_date}`);
    }
  }, [booking]);

  if (!bookingId || !booking) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.title}>PayFast checkout</Text>
        <Text style={styles.subtitle}>Select a booking first to start a secure payment flow.</Text>
        <TouchableOpacity style={styles.secondary} onPress={() => navigation.navigate('Root', { screen: 'Bookings' })}>
          <Text style={styles.secondaryText}>Open bookings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const generatePaymentLink = async () => {
    if (!bookingId || !booking) {
      Alert.alert('Booking required', 'Open payment from a booking to continue.');
      return;
    }
    if (!returnUrl || !cancelUrl || !notifyUrl) {
      setStatusMessage('Payment setup is incomplete. Please contact support.');
      Alert.alert('Payment unavailable', 'Payment callback URLs are not configured.');
      return;
    }

    setLoadingLink(true);
    setStatusMessage('Creating signed PayFast URL...');
    try {
      const { paymentUrl: signedPaymentUrl } = await createPayfastCheckoutLink({
        bookingId,
        returnUrl,
        cancelUrl,
        notifyUrl,
      });
      setPaymentUrl(signedPaymentUrl);
      setStatusMessage('Signed PayFast link ready. Complete checkout to continue.');
    } catch (error: any) {
      const message = error?.message ?? 'Unable to sign the request.';
      setStatusMessage('Could not create a signed link.');
      Alert.alert('Payment unavailable', message);
    } finally {
      setLoadingLink(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>PayFast checkout</Text>
      <Text style={styles.subtitle}>
        Payments run in a secure flow. Booking status updates only after confirmed payment verification.
      </Text>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Item</Text>
          <Text style={styles.summaryValue}>{checkoutItemName}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Estimated amount</Text>
          <Text style={styles.summaryValue}>{checkoutAmount}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.primary} onPress={generatePaymentLink} disabled={loadingLink}>
        <Text style={styles.primaryText}>{loadingLink ? 'Signing request...' : 'Generate PayFast link'}</Text>
      </TouchableOpacity>

      {paymentUrl ? (
        <PaymentWebView
          paymentUrl={paymentUrl}
          onSuccess={Platform.OS === 'web' ? undefined : handleSuccess}
          onError={handleError}
          successUrlPrefix={returnUrl ?? undefined}
          cancelUrlPrefix={cancelUrl ?? undefined}
        />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>Awaiting signed link</Text>
          <Text style={styles.placeholderText}>
            A secure payment link will appear here after setup completes.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Payment confirmation</Text>
        <Text style={styles.paragraph}>
          Payments are confirmed on the server before booking status updates. This helps protect against fraud and false positives.
        </Text>
        <Text style={styles.paragraph}>If confirmation is delayed, pull to refresh your booking status.</Text>
        <TouchableOpacity
          style={styles.secondary}
          onPress={() =>
            bookingId
              ? navigation.navigate('BookingDetail', { bookingId })
              : navigation.navigate('Root', { screen: 'Bookings' })
          }
        >
          <Text style={styles.secondaryText}>Return to booking</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.status}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={styles.statusValue}>{statusMessage}</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  emptyState: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
    backgroundColor: '#f7f7fb',
  },
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
    marginTop: 4,
    marginBottom: 12,
    color: '#475569',
  },
  summaryCard: {
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  summaryLabel: {
    color: '#64748b',
    fontWeight: '600',
  },
  summaryValue: {
    color: '#0f172a',
    fontWeight: '700',
  },
  primary: {
    marginTop: 10,
    backgroundColor: '#0f172a',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  placeholder: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
  },
  placeholderTitle: {
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
  },
  placeholderText: {
    color: '#475569',
  },
  card: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  paragraph: {
    marginTop: 6,
    color: '#475569',
  },
  status: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
  },
  statusLabel: {
    color: '#475569',
    fontWeight: '600',
  },
  statusValue: {
    color: '#0f172a',
    fontWeight: '800',
    marginTop: 4,
  },
  secondary: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
  },
  secondaryText: {
    color: '#0f172a',
    fontWeight: '700',
  },
});

export default PaymentScreen;
