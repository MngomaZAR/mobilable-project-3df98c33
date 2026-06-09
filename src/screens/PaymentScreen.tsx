import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { PaymentWebView } from '../components/PaymentWebView';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { createPayfastCheckoutLink } from '../services/paymentService';
import { createDispatch } from '../services/dispatchService';
import { updateBookingDispatchInDb } from '../services/bookingService';
import HowItWorksCard from '../components/HowItWorksCard';
import { getDefaultPayfastNotifyUrl } from '../config/commercePolicy';
import { BookingStatus } from '../types';

type Route = RouteProp<RootStackParamList, 'Payment'>;
type Navigation = StackNavigationProp<RootStackParamList, 'Payment'>;

const PAYMENT_SUCCESS_URL = 'papzi://payfast/success';
const PAYMENT_CANCEL_URL = 'papzi://payfast/cancel';
const VERIFIED_BOOKING_STATUSES: BookingStatus[] = ['accepted', 'in_progress', 'completed', 'reviewed', 'paid_out'];

const PaymentScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, fetchBookings } = useAppData();
  const booking = useMemo(
    () => (params?.bookingId ? state.bookings.find((item) => item.id === params.bookingId) : undefined),
    [params?.bookingId, state.bookings]
  );
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Create a signed link to start PayFast checkout.');
  const [loadingLink, setLoadingLink] = useState(false);
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchStarted, setDispatchStarted] = useState(false);
  const verificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bookingId = params?.bookingId;
  const dispatchIntent = params?.dispatchIntent;
  const checkoutItemName = booking?.package_type ?? 'Photography booking';
  const checkoutAmount = booking?.total_amount ? `R${booking.total_amount.toLocaleString()}` : 'R1,200';
  const paymentConfirmed = Boolean(booking && VERIFIED_BOOKING_STATUSES.includes(booking.status));

  const clearVerificationTimer = useCallback(() => {
    if (verificationTimerRef.current) {
      clearTimeout(verificationTimerRef.current);
      verificationTimerRef.current = null;
    }
  }, []);

  const startDispatchAfterVerification = useCallback(async () => {
    if (!dispatchIntent || dispatchStarted || !bookingId || !booking) return;
    if (booking.dispatch_request_id) {
      setDispatchStarted(true);
      setStatusMessage('Payment confirmed. Dispatch is already active.');
      return;
    }

    try {
      setDispatching(true);
      setStatusMessage('Payment confirmed. Starting dispatch...');
      const dispatch = await createDispatch({
        booking_id: bookingId,
        service_type: dispatchIntent.serviceType,
        fanout_count: dispatchIntent.fanoutCount,
        intensity_level: dispatchIntent.intensityLevel,
        sla_timeout_seconds: 90,
        requested_lat: dispatchIntent.requestedLat,
        requested_lng: dispatchIntent.requestedLng,
        base_amount: dispatchIntent.baseAmount,
        required_tier: dispatchIntent.tierId,
        required_equipment: dispatchIntent.equipment,
      });

      await updateBookingDispatchInDb(bookingId, {
        dispatch_request_id: dispatch.dispatch_request?.id ?? null,
        assignment_state: (dispatch.assignment_state as any) ?? 'offered',
        quote_token: dispatch.quote?.quote_token ?? null,
        eta_confidence: dispatch.eta_confidence ?? null,
      });

      await fetchBookings(state.currentUser?.id);
      setDispatchStarted(true);
      setStatusMessage('Payment confirmed. Dispatch started and waiting for offers.');
    } catch (error: any) {
      setStatusMessage(error?.message || 'Payment was confirmed, but dispatch did not start yet.');
    } finally {
      setDispatching(false);
    }
  }, [booking, bookingId, dispatchIntent, dispatchStarted, fetchBookings, state.currentUser?.id]);

  const handleSuccess = () => {
    setAwaitingVerification(true);
    setPaymentUrl(null);
    setStatusMessage('Checkout completed. Waiting for secure payment confirmation...');
    Alert.alert(
      'Processing payment',
      'Your checkout is complete. We are verifying the payment with the server before updating the booking.'
    );
  };

  const handleError = (message: string) => {
    if (message === 'Payment cancelled') {
      clearVerificationTimer();
      setAwaitingVerification(false);
      setPaymentUrl(null);
    }
    setStatusMessage(message);
  };

  const supabaseBaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? null;
  const returnUrl = PAYMENT_SUCCESS_URL;
  const cancelUrl = PAYMENT_CANCEL_URL;
  const notifyUrl = supabaseBaseUrl ? getDefaultPayfastNotifyUrl() : null;

  useEffect(() => {
    if (booking?.booking_date) {
      setStatusMessage(`Payment requested for ${booking.booking_date}`);
    }
  }, [booking]);

  useEffect(() => {
    if (!awaitingVerification || !bookingId) return;

    let cancelled = false;
    const startedAt = Date.now();

    const pollBooking = async () => {
      try {
        await fetchBookings(state.currentUser?.id);
      } catch {
        // handled by AppDataContext
      }

      if (cancelled) return;

      const latestBooking = state.bookings.find((item) => item.id === bookingId) ?? booking;
      const latestStatus = latestBooking?.status;
      if (latestStatus && VERIFIED_BOOKING_STATUSES.includes(latestStatus)) {
        clearVerificationTimer();
        setAwaitingVerification(false);
        setStatusMessage('Payment confirmed. Booking status is syncing now.');
        return;
      }

      if (Date.now() - startedAt >= 45000) {
        clearVerificationTimer();
        setAwaitingVerification(false);
        setStatusMessage('Payment is still being verified. Open the booking again in a moment to refresh status.');
        return;
      }

      verificationTimerRef.current = setTimeout(pollBooking, 3000);
    };

    void pollBooking();

    return () => {
      cancelled = true;
      clearVerificationTimer();
    };
  }, [awaitingVerification, booking, bookingId, clearVerificationTimer, fetchBookings, state.bookings, state.currentUser?.id]);

  useEffect(() => {
    if (!paymentConfirmed) return;
    if (awaitingVerification) {
      clearVerificationTimer();
      setAwaitingVerification(false);
    }
    if (dispatchIntent && !dispatchStarted && !dispatching) {
      void startDispatchAfterVerification();
      return;
    }
    if (!dispatchIntent) {
      setStatusMessage('Payment confirmed. Return to the booking for the latest status.');
    }
  }, [
    awaitingVerification,
    clearVerificationTimer,
    dispatchIntent,
    dispatchStarted,
    dispatching,
    paymentConfirmed,
    startDispatchAfterVerification,
  ]);

  useEffect(() => () => clearVerificationTimer(), [clearVerificationTimer]);

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
      setAwaitingVerification(false);
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
      {dispatchIntent ? (
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Dispatch</Text>
            <Text style={styles.summaryValue}>Queued after payment</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Fanout</Text>
            <Text style={styles.summaryValue}>{dispatchIntent.fanoutCount}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Intensity</Text>
            <Text style={styles.summaryValue}>{dispatchIntent.intensityLevel}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Location</Text>
            <Text style={styles.summaryValue}>{dispatchIntent.locationLabel ?? 'Current location'}</Text>
          </View>
        </View>
      ) : null}

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
        <Text style={styles.paragraph}>
          Redirects only return you to the app. Payment truth comes from secure backend verification.
        </Text>
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

      <HowItWorksCard
        title="How Payment Protection Works"
        dismissible={false}
        variant="warning"
        items={[
          'A signed checkout link is generated before redirecting to the payment gateway.',
          'Redirects do not mark payment as complete on their own.',
          'Booking status updates only after verified callback confirmation from backend.',
          'Delayed confirmations keep your booking pending until verification completes.',
          'Return to booking details for the latest payment and status timeline.',
        ]}
      />

      <View style={styles.status}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={styles.statusValue}>
          {dispatching ? 'Dispatching...' : awaitingVerification ? 'Verifying payment...' : statusMessage}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  emptyState: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
    backgroundColor: '#07111f',
  },
  container: {
    padding: 16,
    backgroundColor: '#07111f',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
    color: '#cbd5e1',
  },
  summaryCard: {
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  summaryLabel: {
    color: '#cbd5e1',
    fontWeight: '600',
  },
  summaryValue: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  primary: {
    marginTop: 10,
    backgroundColor: '#fbbf24',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryText: {
    color: '#07111f',
    fontWeight: '700',
  },
  placeholder: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  placeholderTitle: {
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 6,
  },
  placeholderText: {
    color: '#cbd5e1',
  },
  card: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  paragraph: {
    marginTop: 6,
    color: '#cbd5e1',
  },
  status: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  statusLabel: {
    color: '#cbd5e1',
    fontWeight: '600',
  },
  statusValue: {
    color: '#f8fafc',
    fontWeight: '800',
    marginTop: 4,
  },
  secondary: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  secondaryText: {
    color: '#f8fafc',
    fontWeight: '700',
  },
});

export default PaymentScreen;
