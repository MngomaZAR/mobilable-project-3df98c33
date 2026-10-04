import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { PaymentWebView } from '../components/PaymentWebView';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { useServiceAccess } from '../hooks/useServiceAccess';
import { createPayfastCheckoutLink } from '../services/paymentService';
import { fetchBookingById } from '../services/bookingService';
import { getDefaultPayfastNotifyUrl } from '../config/commercePolicy';

type Route = RouteProp<RootStackParamList, 'Payment'>;
type Navigation = StackNavigationProp<RootStackParamList, 'Payment'>;
const SUCCESS_URL = 'papzi://payfast/success';
const CANCEL_URL = 'papzi://payfast/cancel';

const PaymentScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, fetchBookings } = useAppData();
  const { colors } = useTheme();
  const access = useServiceAccess();
  const bookingId = params?.bookingId;
  const booking = useMemo(() => state.bookings.find(item => item.id === bookingId), [bookingId, state.bookings]);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const deadline = useRef(0);
  const submitting = useRef(false);
  const confirmed = booking?.payment_status === 'paid';
  const canPay = booking?.client_id === state.currentUser?.id && booking?.status === 'accepted' && booking?.payment_status === 'unpaid';

  const beginVerification = useCallback(() => {
    deadline.current = Date.now() + 45000;
    setVerifying(true);
    setMessage('Waiting for payment confirmation.');
  }, []);

  useEffect(() => {
    if (!verifying || !bookingId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        // Read the result directly rather than a stale state closure after refresh.
        const saved = await fetchBookingById(bookingId);
        if (cancelled) return;
        if (saved?.payment_status === 'paid') {
          setVerifying(false);
          setPaymentUrl(null);
          setMessage('Payment confirmed.');
          void fetchBookings(state.currentUser?.id);
          return;
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Could not refresh payment status.');
      }
      if (cancelled) return;
      if (Date.now() >= deadline.current) {
        setVerifying(false);
        setMessage('Payment is not yet confirmed. Check again or contact booking support. Do not pay twice.');
        return;
      }
      timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [verifying, bookingId, fetchBookings, state.currentUser?.id]);

  useEffect(() => {
    if (confirmed) { setVerifying(false); setPaymentUrl(null); setMessage('Payment confirmed.'); }
  }, [confirmed]);
  useEffect(() => { setPaymentUrl(null); setVerifying(false); setMessage(''); }, [bookingId]);

  const pay = async () => {
    if (!bookingId || !canPay || !access.allowed('checkout') || submitting.current || verifying) return;
    submitting.current = true;
    setLoading(true);
    try {
      const result = await createPayfastCheckoutLink({ bookingId, returnUrl: SUCCESS_URL, cancelUrl: CANCEL_URL, notifyUrl: getDefaultPayfastNotifyUrl() });
      setPaymentUrl(result.paymentUrl);
      setMessage('Checkout opened. Payment remains unconfirmed.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Checkout is unavailable.';
      setMessage(detail);
      Alert.alert('Payment unavailable', detail);
    } finally { submitting.current = false; setLoading(false); }
  };

  const unavailable = !access.allowed('checkout');
  const disabled = unavailable || !canPay || loading || verifying || !!paymentUrl;
  const label = confirmed ? 'Payment confirmed' : loading ? 'Opening checkout...' : verifying ? 'Verifying payment...' : canPay ? 'Pay for shoot' : 'Awaiting creator acceptance';
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Payment</Text>
      {booking ? <>
        <Text style={[styles.item, { color: colors.textSecondary }]}>{booking.package_type || 'Creator booking'}</Text>
        <Text style={[styles.amount, { color: colors.text }]}>{new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(booking.total_amount)}</Text>
      </> : <Text style={[styles.notice, { color: colors.textSecondary }]}>Open payment from a booking.</Text>}
      {unavailable && <Text accessibilityRole="alert" style={[styles.notice, { color: colors.textSecondary }]}>
        {access.loading ? 'Checking payment availability...' : access.error || 'Checkout is paused until live refunds and creator settlement are accepted.'}
      </Text>}
      {access.error && <TouchableOpacity accessibilityRole="button" onPress={access.retry} style={styles.row}><Ionicons name="refresh-outline" size={20} color={colors.accent} /><Text style={{ color: colors.accent }}>Retry</Text></TouchableOpacity>}
      {access.controlledTest && <Text style={[styles.notice, { color: colors.textSecondary }]}>Controlled test account. Payment limit: R{access.paymentLimit}.</Text>}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => void pay()}
        style={[styles.pay, { backgroundColor: colors.accent, opacity: disabled ? 0.45 : 1 }]}>
        <Ionicons name="card-outline" size={20} color={colors.bg} /><Text style={[styles.payLabel, { color: colors.bg }]}>{label}</Text>
      </TouchableOpacity>
      {paymentUrl && <PaymentWebView paymentUrl={paymentUrl} successUrlPrefix={SUCCESS_URL} cancelUrlPrefix={CANCEL_URL}
        onSuccess={() => { setPaymentUrl(null); beginVerification(); }}
        onError={detail => { setMessage(detail); if (detail === 'Payment cancelled') setPaymentUrl(null); }} />}
      {!confirmed && booking && <TouchableOpacity accessibilityRole="button" disabled={verifying} onPress={beginVerification} style={styles.row}>
        <Ionicons name="refresh-outline" size={20} color={colors.text} /><Text style={{ color: colors.text }}>Check payment status</Text>
      </TouchableOpacity>}
      {!!message && <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: colors.text }]}>{message}</Text>}
      <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => bookingId ? navigation.navigate('BookingDetail', { bookingId }) : navigation.navigate('Root', { screen: 'Bookings' })}>
        <Ionicons name="arrow-back" size={20} color={colors.text} /><Text style={{ color: colors.text }}>Return to booking</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, width: '100%', maxWidth: 760, alignSelf: 'center', gap: 16 },
  title: { fontSize: 22, fontWeight: '700' },
  item: { fontSize: 15 },
  amount: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  notice: { fontSize: 14, lineHeight: 21 },
  pay: { flexDirection: 'row', gap: 10, minHeight: 48, padding: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  payLabel: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  row: { flexDirection: 'row', gap: 12, minHeight: 48, alignItems: 'center' },
});
export default PaymentScreen;
