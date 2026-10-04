import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { canTrackBooking, getBookingChatTarget, getBookingProviderId, isReviewableBooking } from '../utils/bookingWorkflow';
import { fetchBookingById, updateBookingStatusInDb } from '../services/bookingService';
import { Booking } from '../types';
import { formatBookingStart } from '../utils/bookingTime';
import { BETA_RESTRICTION_MESSAGE } from '../config/betaPolicy';
import { useServiceAccess } from '../hooks/useServiceAccess';
import { createDispatch } from '../services/dispatchService';

type Route = RouteProp<RootStackParamList, 'BookingDetail'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingDetail'>;

const moneyFormatter = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

const BookingDetailScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { state, startConversationWithUser, updateBookingStatus } = useAppData();
  const access = useServiceAccess();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const cachedBooking = useMemo(() => state.bookings.find(item => item.id === params.bookingId), [params.bookingId, state.bookings]);
  const [fetchedBooking, setFetchedBooking] = useState<Booking | null>(null);
  const [loadingBooking, setLoadingBooking] = useState(!cachedBooking);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const viewerId = state.currentUser?.id;
  useEffect(() => {
    let active = true;
    setFetchedBooking(null);
    setBookingError(null);
    if (cachedBooking || !viewerId) { setLoadingBooking(false); return; }
    setLoadingBooking(true);
    fetchBookingById(params.bookingId)
      .then(saved => { if (active) setFetchedBooking(saved); })
      .catch(error => { if (active) setBookingError(error instanceof Error ? error.message : 'Could not load this booking.'); })
      .finally(() => { if (active) setLoadingBooking(false); });
    return () => { active = false; };
  }, [cachedBooking, viewerId, params.bookingId, loadAttempt]);
  const booking = fetchedBooking || cachedBooking;
  const refreshStatus = booking?.status;
  useEffect(() => {
    if (!viewerId || !['pending', 'accepted', 'in_progress'].includes(refreshStatus || '')) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const saved = await fetchBookingById(params.bookingId);
        if (active) { setFetchedBooking(saved); setBookingError(null); }
      } catch (error) {
        if (active) setBookingError(error instanceof Error ? error.message : 'Could not refresh booking.');
      }
      if (active) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => { active = false; clearTimeout(timer); };
  }, [viewerId, params.bookingId, refreshStatus]);

  if (!booking) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.bg }]}>
        {loadingBooking ? <ActivityIndicator accessibilityLabel="Loading booking" color={colors.accent} /> : <Text style={{ color: colors.text }}>{bookingError || (viewerId ? 'This booking is unavailable or you do not have access.' : 'Sign in to view this booking.')}</Text>}
        {bookingError && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry booking" style={styles.action} onPress={() => setLoadAttempt(attempt => attempt + 1)}><Text style={{ color: colors.accent }}>Retry</Text></TouchableOpacity>}
        <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => navigation.navigate('Root', { screen: 'Bookings' })}>
          <Text style={{ color: colors.accent }}>Back to bookings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const providerId = getBookingProviderId(booking);
  const provider = state.models.find(item => item.id === providerId) || state.photographers.find(item => item.id === providerId);
  const providerProfile = state.profiles.find(item => item.id === providerId);
  const talentName = provider?.name || providerProfile?.full_name || booking.photographer?.name || 'Creator';
  const isClient = booking.client_id === viewerId;
  const isProvider = !!viewerId && providerId === viewerId;
  const canRespond = isProvider && booking.status === 'pending' && !booking.is_instant && !booking.dispatch_request_id;
  const canCall = (isClient || isProvider) && ['accepted', 'in_progress'].includes(booking.status) &&
    ['photography', 'modeling', 'combined'].includes(booking.service_type || '');
  const chatTarget = getBookingChatTarget(booking, viewerId);
  const requiresPayment = booking.status === 'accepted' && booking.payment_status === 'unpaid';
  const canPay = requiresPayment && isClient;
  const canCancel = !!chatTarget && (booking.status === 'pending' || booking.status === 'accepted');
  const busy = loadingAction !== null;
  const saveStatus = (status: 'accepted' | 'declined' | 'cancelled') => cachedBooking
    ? updateBookingStatus(booking.id, status) : updateBookingStatusInDb(booking.id, status);
  const respondToBooking = async (status: 'accepted' | 'declined') => {
    if (busy || !canRespond) return;
    setLoadingAction(status);
    setActionNotice(null);
    try {
      const saved = await saveStatus(status);
      if (!saved || saved.status !== status) throw new Error('Your response was not confirmed. Please retry.');
      setFetchedBooking(saved);
      setActionNotice(status === 'accepted' ? 'Booking accepted. Awaiting payment.' : 'Booking declined.');
    } catch (error) { setActionNotice(error instanceof Error ? error.message : 'Could not respond to this booking.'); }
    finally { setLoadingAction(null); }
  };
  const dateLabel = formatBookingStart(booking);
  const progress = [
    { label: 'Request sent', done: true },
    { label: 'Creator accepted', done: ['accepted', 'in_progress', 'completed', 'reviewed', 'paid_out'].includes(booking.status) },
    { label: 'Payment confirmed', done: booking.payment_status === 'paid' },
    { label: 'Shoot completed', done: ['completed', 'reviewed', 'paid_out'].includes(booking.status) },
  ];
  const statusLabel = booking.status === 'accepted' && requiresPayment ? 'Accepted, awaiting payment' : booking.status.replace(/_/g, ' ');
  const retryMatching = async () => {
    if (busy || !access.allowed('dispatch')) return;
    setLoadingAction('dispatch');
    try {
      await createDispatch({ booking_id: booking.id, service_type: booking.model_id ? 'modeling' : 'photography',
        fanout_count: booking.fanout_count || 1, intensity_level: booking.intensity_level || 1,
        idempotency_key: `dispatch:${booking.id}` });
      setFetchedBooking(await fetchBookingById(booking.id));
      setActionNotice('Matching started. Waiting for creator acceptance.');
    } catch (error) { setActionNotice(error instanceof Error ? error.message : 'Matching failed. Please retry.'); }
    finally { setLoadingAction(null); }
  };

  const openChatThread = async () => {
    if (!chatTarget || busy) return;
    const title = isClient ? talentName : booking.client?.name || 'Client';
    setLoadingAction('chat');
    setActionNotice(null);
    try {
      const conversation = await startConversationWithUser(chatTarget, title);
      navigation.navigate('ChatThread', { conversationId: conversation.id, title: conversation.title });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please retry.';
      setActionNotice(message);
      Alert.alert('Chat unavailable', message);
    } finally {
      setLoadingAction(null);
    }
  };

  const openSupport = () => navigation.navigate('Support', { bookingId: booking.id, category: 'billing', subject: 'Booking issue' });
  const cancelBooking = async () => {
    if (busy) return;
    setLoadingAction('cancel');
    setActionNotice(null);
    try {
      const saved = await saveStatus('cancelled');
      if (!saved || saved.status !== 'cancelled') throw new Error('Cancellation was not confirmed. Please refresh and retry.');
      const message = booking.payment_status === 'paid' ? 'Your payment record is unchanged. Contact support to request a refund.' : 'Your booking has been cancelled.';
      setFetchedBooking(saved);
      setActionNotice(message);
      Alert.alert('Booking cancelled', message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please retry.';
      setActionNotice(message);
      Alert.alert('Cancellation failed', message);
    } finally {
      setLoadingAction(null);
    }
  };
  const handleCancel = () => {
    if (busy) return;
    if (Platform.OS === 'web') {
      if (globalThis.confirm('Cancel booking? Cancellation does not confirm or issue a refund.')) void cancelBooking();
      return;
    }
    Alert.alert('Cancel booking?', 'Cancellation does not confirm or issue a refund.', [
      { text: 'Keep booking', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: cancelBooking },
    ]);
  };

  const action = (label: string, icon: React.ComponentProps<typeof Ionicons>['name'], onPress: () => void, disabled = false, destructive = false) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy} onPress={onPress}
      style={[styles.action, { borderColor: colors.border, opacity: disabled || busy ? 0.45 : 1 }]}>
      <Ionicons name={icon} size={20} color={destructive ? colors.destructive : colors.text} />
      <Text style={[styles.actionLabel, { color: destructive ? colors.destructive : colors.text }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.container, { paddingTop: Math.max(16, insets.top + 8), paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={styles.back}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{booking.package_type || 'Booking'}</Text>
      </View>
      <Text style={[styles.provider, { color: colors.text }]}>{talentName}</Text>
      <Text selectable style={[styles.meta, { color: colors.textSecondary }]}>{dateLabel}</Text>
      <View style={[styles.summary, { borderColor: colors.border }]}>
        <Text accessibilityLabel={'Booking status: ' + statusLabel} style={[styles.status, { color: colors.text }]}>{statusLabel}</Text>
        <Text selectable style={[styles.amount, { color: colors.text }]}>{moneyFormatter.format(booking.total_amount)}</Text>
      </View>
      {booking.notes ? <Text selectable style={[styles.notes, { color: colors.textSecondary }]}>{booking.notes}</Text> : null}
      <View style={[styles.timeline, { borderColor: colors.border }]}>
        {progress.map(step => <View key={step.label} style={styles.step}>
          <Ionicons name={step.done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={step.done ? colors.accent : colors.textMuted} />
          <Text style={[styles.stepLabel, { color: step.done ? colors.text : colors.textSecondary }]}>{step.label}</Text>
        </View>)}
      </View>
      {requiresPayment ? <Text style={[styles.notes, { color: colors.textSecondary }]}>Awaiting payment confirmation.</Text> : null}
      {actionNotice && <Text accessibilityRole="alert" style={[styles.notes, { color: colors.text }]}>{actionNotice}</Text>}
      {bookingError && <Text accessibilityRole="alert" style={[styles.notes, { color: colors.textSecondary }]}>{bookingError}</Text>}
      {booking.is_instant && booking.status === 'pending' && !booking.dispatch_request_id ? action('Retry creator matching', 'refresh-outline', () => void retryMatching(), !access.allowed('dispatch')) : null}
      {booking.dispatch_request_id && booking.status === 'pending' ? <Text style={[styles.notes, { color: colors.textSecondary }]}>Creator matching: {booking.assignment_state || 'offered'}</Text> : null}
      {canRespond ? <>
        {action(loadingAction === 'accepted' ? 'Accepting...' : 'Accept booking', 'checkmark-circle-outline', () => void respondToBooking('accepted'))}
        {action(loadingAction === 'declined' ? 'Declining...' : 'Decline booking', 'close-circle-outline', () => void respondToBooking('declined'), false, true)}
      </> : null}
      {action(loadingAction === 'chat' ? 'Opening chat...' : 'Open chat', 'chatbubble-outline', openChatThread, !chatTarget)}
      {canCall && Platform.OS !== 'web' ? <>
        {action('Booking video call', 'videocam-outline', () => navigation.navigate('PaidVideoCall', { bookingId: booking.id }), !access.allowed('video'))}
        {access.error ? action('Retry service connection', 'refresh-outline', access.retry, access.loading) : null}
      </> : null}
      {action('Track on map', 'navigate-outline', () => navigation.navigate('BookingTracking', { bookingId: booking.id }), !canTrackBooking(booking))}
      {canPay ? action('Pay for shoot', 'card-outline', () => navigation.navigate('Payment', { bookingId: booking.id }), !access.allowed('checkout')) : null}
      {canPay && !access.allowed('checkout') ? <Text accessibilityRole="alert" style={[styles.notes, { color: colors.textSecondary }]}>{BETA_RESTRICTION_MESSAGE}</Text> : null}
      {canCancel ? <>
        {action('Discuss a new time', 'calendar-outline', openChatThread)}
        {action(loadingAction === 'cancel' ? 'Cancelling...' : 'Cancel booking', 'close-circle-outline', handleCancel, false, true)}
      </> : null}
      {isReviewableBooking(booking, viewerId, providerId) ? action('Leave a review', 'star-outline', () => navigation.navigate('Reviews', { photographerId: providerId, bookingId: booking.id })) : null}
      {isClient && ['completed', 'reviewed', 'paid_out'].includes(booking.status) ? action('Book again', 'refresh-outline', () => navigation.navigate('BookingForm', booking.model_id ? { modelId: providerId, serviceType: 'modeling' } : { photographerId: providerId, serviceType: 'photography' })) : null}
      {action('Booking support', 'help-circle-outline', openSupport)}
      {action('Documents and contracts', 'document-text-outline', () => navigation.navigate('ModelRelease', { bookingId: booking.id }))}
      <Text selectable style={[styles.reference, { color: colors.textMuted }]}>Booking reference: {booking.id}</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', flex: 1, minWidth: 0 },
  provider: { fontSize: 18, fontWeight: '600' },
  meta: { fontSize: 14, marginTop: 6 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  status: { fontSize: 14, fontWeight: '600', textTransform: 'capitalize', flexShrink: 1 },
  amount: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  notes: { fontSize: 14, lineHeight: 21, marginTop: 16 },
  timeline: { paddingVertical: 20, gap: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepLabel: { fontSize: 14, flex: 1 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  reference: { fontSize: 12, lineHeight: 18, marginTop: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
});

export default BookingDetailScreen;

