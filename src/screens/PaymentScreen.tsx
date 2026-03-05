import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Platform } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { PaymentWebView } from '../components/PaymentWebView';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { supabase } from '../config/supabaseClient';

type Route = RouteProp<RootStackParamList, 'Payment'>;
type Navigation = StackNavigationProp<RootStackParamList, 'Payment'>;

const PaymentScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, updateBookingStatus, trackEvent } = useAppData();
  const booking = useMemo(
    () => (params?.bookingId ? state.bookings.find((item) => item.id === params.bookingId) : undefined),
    [params?.bookingId, state.bookings]
  );
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Create a signed link to start PayFast checkout.');
  const [itemName, setItemName] = useState('Photography booking');
  const [amount, setAmount] = useState('1200');
  const [loadingLink, setLoadingLink] = useState(false);

  const bookingId = params?.bookingId;

  const handleSuccess = async () => {
    setStatusMessage('Payment succeeded. Updating booking...');
    if (paymentId) {
      await supabase.from('payments').update({ status: 'paid' }).eq('id', paymentId);
    }
    if (bookingId) await updateBookingStatus(bookingId, 'accepted');
    Alert.alert('Payment confirmed', 'Booking status advanced after PayFast callback.');
  };

  const handleError = (message: string) => {
    setStatusMessage(message);
  };

  const returnUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL?.concat('/payfast/return') ?? 'https://example.com/payfast/return';
  const cancelUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL?.concat('/payfast/cancel') ?? 'https://example.com/payfast/cancel';
  const notifyUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL?.concat('/functions/v1/payfast-handler/notify') ??
    'https://example.com/payfast/notify';

  useEffect(() => {
    if (booking?.package) {
      setItemName(booking.package);
    }
    if (booking?.date) {
      setStatusMessage(`Payment requested for ${booking.date}`);
    }
    if (typeof booking?.priceTotal === 'number' && Number.isFinite(booking.priceTotal)) {
      setAmount(booking.priceTotal.toFixed(2));
    }
  }, [booking]);

  const generatePaymentLink = async () => {
    const amountValue = typeof booking?.priceTotal === 'number' ? booking.priceTotal : Number(amount);
    if (!Number.isFinite(amountValue)) {
      Alert.alert('Amount required', 'Enter a valid amount in your currency.');
      return;
    }
    const amountString = amountValue.toFixed(2);

    setLoadingLink(true);
    setStatusMessage('Creating signed PayFast URL...');
    let nextPaymentId: string | null = paymentId;
    if (bookingId && !nextPaymentId) {
      const { data: paymentRow, error: paymentError } = await supabase
        .from('payments')
        .insert({
          booking_id: bookingId,
          provider: 'payfast',
          amount: Number(amountString),
          status: 'initiated',
        })
        .select('id')
        .single();
      if (paymentError) {
        setStatusMessage('Unable to create payment record.');
        Alert.alert('Payment error', paymentError.message);
        setLoadingLink(false);
        return;
      }
      nextPaymentId = paymentRow?.id ?? null;
      setPaymentId(nextPaymentId);
    }

    const { data, error } = await supabase.functions.invoke('payfast-handler', {
      body: {
        amount: amountString,
        item_name: itemName,
        return_url: returnUrl,
        cancel_url: cancelUrl,
        notify_url: notifyUrl,
        booking_id: bookingId,
        payment_id: nextPaymentId,
      },
    });
    if (error || !data?.paymentUrl) {
      setStatusMessage('Could not create a signed link.');
      Alert.alert('PayFast error', error?.message ?? 'Unable to sign the request.');
    } else {
      if (nextPaymentId) {
        await supabase.from('payments').update({ status: 'pending' }).eq('id', nextPaymentId);
      }
      setPaymentUrl(data.paymentUrl);
      await trackEvent('payment_link_generated', { bookingId });
      setStatusMessage('Signed PayFast link ready. Complete checkout to advance booking.');
    }
    setLoadingLink(false);
  };

  const webhookSnippet = useMemo(
    () =>
      `Deno.serve(async (req) => {
  // Validate PayFast signature + amount
  const event = await req.json();
  if (event?.payment_status === 'COMPLETE') {
    // Update booking row securely
  }
  return new Response('ok', { status: 200 });
});`,
    []
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>PayFast checkout</Text>
      <Text style={styles.subtitle}>
        Payments run in a secure WebView. Web uses a new tab; native keeps the user in-app.
      </Text>

      <View style={styles.fieldRow}>
        <View style={styles.field}>
          <Text style={styles.label}>Item</Text>
          <TextInput value={itemName} onChangeText={setItemName} style={styles.input} placeholder="Booking package" />
        </View>
        <View style={[styles.field, styles.amountField]}>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            style={styles.input}
            keyboardType="numeric"
            placeholder="1200"
            editable={typeof booking?.priceTotal !== 'number'}
          />
        </View>
      </View>

      <TouchableOpacity style={styles.primary} onPress={generatePaymentLink} disabled={loadingLink}>
        <Text style={styles.primaryText}>{loadingLink ? 'Signing request...' : 'Generate PayFast link'}</Text>
      </TouchableOpacity>

      {paymentUrl ? (
        <PaymentWebView paymentUrl={paymentUrl} onSuccess={handleSuccess} onError={handleError} />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>Awaiting signed link</Text>
          <Text style={styles.placeholderText}>
            We only expose public fields here. Merchant keys and signatures are created in your Supabase Edge Function.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Webhook verification</Text>
        <Text style={styles.paragraph}>
          Deploy a single Supabase Edge Function to validate the PayFast signature and move the booking to accepted.
        </Text>
        <Text style={styles.paragraph}>Notify URL: {notifyUrl}</Text>
        <View style={styles.codeBlock}>
          <Text style={styles.code}>{webhookSnippet}</Text>
        </View>
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

      {Platform.OS === 'web' ? (
        <Text style={styles.helper}>
          Complete the PayFast checkout in the new tab to update the booking status.
        </Text>
      ) : null}
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
    marginTop: 4,
    marginBottom: 12,
    color: '#475569',
  },
  fieldRow: {
    flexDirection: 'row',
    marginHorizontal: -4,
  },
  field: {
    flex: 1,
    marginHorizontal: 4,
  },
  amountField: {
    maxWidth: 140,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
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
  codeBlock: {
    backgroundColor: '#0f172a',
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
  },
  code: {
    color: '#e5e7eb',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
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
  cta: {
    marginTop: 10,
    backgroundColor: '#0f172a',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
  },
  helper: {
    marginTop: 12,
    color: '#475569',
    fontWeight: '600',
    textAlign: 'center',
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
