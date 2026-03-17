import React, { useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { BookingStatus } from '../types';
import { Ionicons } from '@expo/vector-icons';
import HowItWorksCard from '../components/HowItWorksCard';

type Route = RouteProp<RootStackParamList, 'BookingDetail'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingDetail'>;

const steps: BookingStatus[] = ['pending', 'accepted', 'completed', 'reviewed'];

const BookingDetailScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { state, startConversationWithUser, updateBookingStatus } = useAppData();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const booking = useMemo(
    () => state.bookings.find((item) => item.id === params.bookingId),
    [params.bookingId, state.bookings]
  );
  const photographer = useMemo(
    () => state.photographers.find((p) => p.id === booking?.photographer_id),
    [booking?.photographer_id, state.photographers]
  );

  const model = useMemo(
    () => state.models.find((m) => m.id === booking?.model_id),
    [booking?.model_id, state.models]
  );
  
  const talentName = useMemo(() => {
    if (model) return model.name;
    if (photographer) return photographer.name;
    return 'your talent';
  }, [model, photographer]);

  if (!booking) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={[styles.muted, { color: colors.textSecondary }]}>We could not find that booking.</Text>
      </View>
    );
  }

  const currentIndex = steps.indexOf(booking.status);

  // Chat with the most relevant person: model > photographer > general chat
  const openChatThread = async () => {
    const chatTarget = model || photographer;
    if (!chatTarget) {
      navigation.navigate('Root', { screen: 'Chat' });
      return;
    }

    try {
      const convo = await startConversationWithUser(chatTarget.id, chatTarget.name);
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch (_err) {
      navigation.navigate('Root', { screen: 'Chat' });
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel Booking',
      'Are you sure you want to cancel this booking? Please review the cancellation policy.',
      [
        { text: 'Nevermind', style: 'cancel' },
        { 
          text: 'Confirm Cancel', 
          style: 'destructive',
          onPress: async () => {
            setLoadingAction('cancel');
            try {
               await updateBookingStatus(booking.id, 'cancelled');
               Alert.alert('Booking Cancelled', 'Your booking has been cancelled and any applicable refunds are being processed.');
            } catch (e: any) {
               Alert.alert('Error', e.message || 'Could not cancel booking.');
            } finally {
               setLoadingAction(null);
            }
          }
        }
      ]
    );
  };

  const handleReschedule = () => {
    Alert.alert('Reschedule Request', 'Please send a message to the talent to coordinate a new time, then they will update the booking.');
  };

  const handleDispute = () => {
    Alert.alert('Open Dispute', 'A support specialist will join this conversation shortly.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Dispute', style: 'destructive' }
    ]);
  };

  const handleBookAgain = () => {
    if (photographer) {
       navigation.navigate('BookingForm', { photographerId: photographer.id });
    } else if (model) {
       navigation.navigate('BookingForm', { photographerId: model.id });
    }
  };


  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: Math.max(16, insets.top + 8) }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>{booking.package_type}</Text>
        </View>
        
        <Text style={[styles.meta, { color: colors.textSecondary }]}>With {talentName}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>Date: {booking.booking_date}</Text>
        
        {booking.notes ? (
          <View style={[styles.notes, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.text }}>{booking.notes}</Text>
          </View>
        ) : null}

        <View style={[styles.timeline, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {steps.map((step, index) => {
            const active = index <= currentIndex;
            return (
              <View key={step} style={styles.stepRow}>
                <View style={[styles.stepDot, { backgroundColor: colors.border }, active && [styles.stepDotActive, { backgroundColor: colors.accent }]]} />
                <Text style={[styles.stepLabel, { color: colors.textMuted }, active && [styles.stepLabelActive, { color: colors.text }]]}>{step}</Text>
              </View>
            );
          })}
        </View>

        <View style={[styles.noticeCard, { backgroundColor: isDark ? '#1e293b' : '#eff6ff', borderColor: isDark ? '#334155' : '#dbeafe' }]}>
          <Text style={[styles.noticeTitle, { color: isDark ? '#93c5fd' : '#1e3a8a' }]}>Status updates</Text>
          <Text style={[styles.noticeText, { color: isDark ? '#cbd5e1' : '#1e40af' }]}>
            Booking progress updates automatically after secure confirmation from payments and operations.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.secondary, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
          onPress={openChatThread}
        >
          <Text style={[styles.secondaryText, { color: colors.text }]}>Open chat</Text>
        </TouchableOpacity>
        
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.secondary, styles.rowButton, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
            onPress={() => navigation.navigate('BookingTracking', { bookingId: booking.id })}
          >
            <Text style={[styles.secondaryText, { color: colors.text }]}>Track on map</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondary, styles.rowButton, { backgroundColor: colors.accent }]}
            onPress={() => navigation.navigate('Payment', { bookingId: booking.id })}
          >
            <Text style={[styles.secondaryText, { color: isDark ? colors.bg : '#fff' }]}>Payments</Text>
          </TouchableOpacity>
        </View>

        {booking.status === 'completed' || booking.status === 'reviewed' ? (
           <TouchableOpacity
             style={[styles.secondary, { backgroundColor: colors.accent, marginTop: 16 }]}
             onPress={handleBookAgain}
           >
             <Text style={[styles.secondaryText, { color: isDark ? colors.bg : '#fff' }]}>Book Again</Text>
           </TouchableOpacity>
        ) : null}

        {booking.status === 'pending' || booking.status === 'accepted' ? (
           <>
             <View style={styles.row}>
               <TouchableOpacity
                 style={[styles.secondary, styles.rowButton, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
                 onPress={handleReschedule}
                 disabled={!!loadingAction}
               >
                 <Text style={[styles.secondaryText, { color: colors.text }]}>Reschedule</Text>
               </TouchableOpacity>
               <TouchableOpacity
                 style={[styles.secondary, styles.rowButton, { backgroundColor: colors.card, borderColor: colors.destructive, borderWidth: 1 }]}
                 onPress={handleCancel}
                 disabled={!!loadingAction}
               >
                 <Text style={[styles.secondaryText, { color: colors.destructive }]}>
                   {loadingAction === 'cancel' ? 'Cancelling...' : 'Cancel'}
                 </Text>
               </TouchableOpacity>
             </View>
           </>
        ) : null}

        {booking.status === 'completed' ? (
           <TouchableOpacity
             style={[styles.secondary, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
             onPress={handleDispute}
             disabled={!!loadingAction}
           >
             <Text style={[styles.secondaryText, { color: colors.text }]}>Report Issue / Dispute</Text>
           </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.secondary, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
          onPress={() => navigation.navigate('ModelRelease', { bookingId: booking.id })}
        >
          <Ionicons name="document-text-outline" size={18} color={colors.text} style={{ marginBottom: 4 }} />
          <Text style={[styles.secondaryText, { color: colors.text }]}>Legal Documents & Contracts</Text>
        </TouchableOpacity>

        <View style={{ marginTop: 14 }}>
          <HowItWorksCard
            title="How Changes Work"
            items={[
              'Reschedule requests are coordinated in chat and reflected in booking updates.',
              'Cancellation triggers policy-based refunds, then status syncs across both users.',
              'Disputes create a support workflow with review logs and final resolution status.',
              'Legal release and contract records stay attached to this booking timeline.',
            ]}
          />
        </View>

        <View style={styles.policyCard}>
           <Text style={[styles.policyTitle, { color: colors.text }]}>Cancellation Policy</Text>
           <Text style={[styles.policyText, { color: colors.textSecondary }]}>• Free cancellation for 48 hours after booking.</Text>
           <Text style={[styles.policyText, { color: colors.textSecondary }]}>• Cancel before 7 days of the shoot for a 50% refund.</Text>
           <Text style={[styles.policyText, { color: colors.textSecondary }]}>• No refunds within 7 days of the shoot date.</Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  backButton: {
    marginRight: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  muted: {
    fontSize: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
  },
  meta: {
    fontSize: 14,
    marginTop: 4,
  },
  notes: {
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  timeline: {
    marginTop: 16,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
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
    marginRight: 10,
  },
  stepDotActive: {
  },
  stepLabel: {
    textTransform: 'capitalize',
    fontWeight: '600',
  },
  stepLabelActive: {
  },
  noticeCard: {
    marginTop: 16,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeTitle: {
    fontWeight: '700',
  },
  noticeText: {
    marginTop: 4,
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
  },
  secondaryText: {
    fontWeight: '700',
  },
  policyCard: {
    marginTop: 24,
    marginBottom: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
  },
  policyTitle: {
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 8,
  },
  policyText: {
    fontSize: 13,
    marginBottom: 4,
    lineHeight: 18,
  },
});

export default BookingDetailScreen;
