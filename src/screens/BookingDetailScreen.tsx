import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { BookingStatus } from '../types';
import { Ionicons } from '@expo/vector-icons';

type Route = RouteProp<RootStackParamList, 'BookingDetail'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingDetail'>;

const steps: BookingStatus[] = ['pending', 'accepted', 'completed', 'reviewed'];

const BookingDetailScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { state, startConversationWithUser } = useAppData();

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

        <TouchableOpacity
          style={[styles.secondary, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
          onPress={() => navigation.navigate('ModelRelease', { bookingId: booking.id })}
        >
          <Ionicons name="document-text-outline" size={18} color={colors.text} style={{ marginBottom: 4 }} />
          <Text style={[styles.secondaryText, { color: colors.text }]}>Legal Documents & Release</Text>
        </TouchableOpacity>
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
});

export default BookingDetailScreen;
