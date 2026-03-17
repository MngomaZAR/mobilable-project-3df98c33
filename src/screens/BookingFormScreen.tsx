import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useMessaging } from '../store/MessagingContext';
import { BookingCalendar } from '../components/BookingCalendar';
import { Ionicons } from '@expo/vector-icons';
import { BOOKING_PACKAGES } from '../constants/pricing';

type Route = RouteProp<RootStackParamList, 'BookingForm'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingForm'>;

const ADDONS = [
  { id: 'studio', label: 'Studio Hire (2h)', price: 500 },
  { id: 'makeup', label: 'Make-up Artist', price: 800 },
  { id: 'rush', label: 'Rush Delivery (24h)', price: 300 },
];

const BookingFormScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, createBooking } = useAppData();
  const { startConversationWithUser } = useMessaging();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [timeSlot, setTimeSlot] = useState('Golden hour (4-7)');
  const [selectedPackageId, setSelectedPackageId] = useState(BOOKING_PACKAGES[1]?.id ?? 'starter');
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [isInstantBook, setIsInstantBook] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const talent = useMemo(
    () => state.photographers.find((item) => item.id === params.photographerId) || 
          state.models.find((item) => item.id === params.photographerId),
    [params.photographerId, state.photographers, state.models]
  );
  const isModelTalent = useMemo(
    () => state.models.some((item) => item.id === params.photographerId),
    [params.photographerId, state.models]
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
    return `${selectedDate.toDateString()} Ã‚Â· ${timeSlot}`;
  }, [selectedDate, timeSlot]);

  const selectedPackage = useMemo(
    () => BOOKING_PACKAGES.find((pkg) => pkg.id === selectedPackageId) ?? BOOKING_PACKAGES[0],
    [selectedPackageId]
  );

  /** Base rate in ZAR derived from price-tier (number of $ signs) */
  const estimatedBaseAmount = useMemo(() => {
    const level = ((talent?.price_range || '').match(/\$/g) || []).length || 2;
    const multiplier = Math.max(0.75, level / 2); // level 2 = 1x baseline
    let total = Math.round(selectedPackage.basePrice * multiplier);
    selectedAddons.forEach(id => {
      const addon = ADDONS.find(a => a.id === id);
      if (addon) total += addon.price;
    });
    return total;
  }, [talent.price_range, selectedPackage.basePrice, selectedAddons]);

  const estimatedRate = `From R${estimatedBaseAmount.toLocaleString('en-ZA')}`;
  const commissionAmount = Math.round(estimatedBaseAmount * 0.30);
  const vatAmount = Math.round(commissionAmount * 0.15); // VAT on the platform fee
  const photographerPayout = estimatedBaseAmount - commissionAmount - vatAmount;

  const handleSubmit = async () => {
    if (!selectedDate) {
      Alert.alert('Date required', 'Please add a shoot date.');
      return;
    }

    try {
      setSubmitting(true);
      // Store booking_date as clean ISO date (YYYY-MM-DD) Ã¢â‚¬â€ Postgres date column compatible
      const normalizedDate = new Date(selectedDate);
      normalizedDate.setUTCHours(12, 0, 0, 0);
      const bookingDate = normalizedDate.toISOString().split('T')[0]; // e.g. '2026-03-15'
      
      const addonNames = Array.from(selectedAddons).map(id => ADDONS.find(a => a.id === id)?.label).filter(Boolean);
      const finalNotes = addonNames.length > 0
        ? `[Add-ons: ${addonNames.join(', ')}]\n${notes}`
        : notes;
        
      const booking = await createBooking({
        talent_id: talent.id,
        talent_type: isModelTalent ? 'model' : 'photographer',
        booking_date: bookingDate,
        package_type: `${selectedPackage.label} â€¢ ${timeSlot}${isInstantBook ? ' (Instant Request)' : ''}`,
        notes: finalNotes,
        base_amount: estimatedBaseAmount,
        travel_amount: 0,
      });
      Alert.alert(isInstantBook ? 'Booking Confirmed' : 'Request sent', isInstantBook ? 'Your booking was instantly confirmed!' : 'Your booking request was submitted and is ready to review.', [
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
        <Text style={styles.heroMeta}>{talent.style} Ã‚Â· {talent.location}</Text>
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
        <Text style={styles.label}>Package Comparison</Text>
        <Text style={styles.packageHint}>Swipe to compare packages side-by-side.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.packageGrid}>
          {BOOKING_PACKAGES.map((pkg) => {
            const isActive = pkg.id === selectedPackageId;
            return (
              <TouchableOpacity
                key={pkg.id}
                style={[styles.packageCard, isActive && styles.packageCardActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelectedPackageId(pkg.id);
                }}
              >
                <Text style={[styles.packageTitle, isActive && styles.packageTitleActive]}>{pkg.label}</Text>
                <Text style={[styles.packageDuration, isActive && styles.packageMetaActive]}>{pkg.duration}</Text>
                <Text style={[styles.packagePrice, isActive && styles.packageTitleActive]}>
                  From R{Math.round(pkg.basePrice).toLocaleString('en-ZA')}
                </Text>
                <Text style={[styles.packageMeta, isActive && styles.packageMetaActive]}>{pkg.description}</Text>
                <Text style={[styles.packageMeta, isActive && styles.packageMetaActive]}>
                  {pkg.highlights.join(' â€¢ ')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.detailsCard}>
        <Text style={styles.label}>Add-ons</Text>
        <Text style={styles.packageHint}>Enhance your shoot with these optional extras.</Text>
        {ADDONS.map(addon => {
          const isSelected = selectedAddons.has(addon.id);
          return (
            <TouchableOpacity 
              key={addon.id} 
              style={[styles.addonRow, isSelected && styles.addonRowActive]}
              onPress={() => {
                Haptics.selectionAsync();
                const next = new Set(selectedAddons);
                if (next.has(addon.id)) next.delete(addon.id); else next.add(addon.id);
                setSelectedAddons(next);
              }}
            >
              <View style={styles.addonLeft}>
                <Ionicons name={isSelected ? "checkbox" : "square-outline"} size={20} color={isSelected ? "#f97316" : "#cbd5e1"} />
                <Text style={[styles.addonLabel, isSelected && styles.addonLabelActive]}>{addon.label}</Text>
              </View>
              <Text style={styles.addonPrice}>+R{addon.price}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.detailsCard}>
         <View style={styles.instantRow}>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={styles.label}>Instant Book</Text>
              <Text style={styles.packageHint}>Skip the approval process and lock in the date instantly.</Text>
            </View>
            <TouchableOpacity 
               style={[styles.toggleSwitch, isInstantBook && styles.toggleSwitchActive]}
               onPress={() => { Haptics.selectionAsync(); setIsInstantBook(!isInstantBook); }}
            >
               <View style={[styles.toggleKnob, isInstantBook && styles.toggleKnobActive]} />
            </TouchableOpacity>
         </View>
      </View>

      <View style={styles.detailsCard}>
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
          <Text style={styles.breakdownLabel}>Platform fee</Text>
          <Text style={[styles.breakdownValue, { color: '#ef4444' }]}>-R{commissionAmount.toLocaleString('en-ZA')}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>VAT (15% on fee)</Text>
          <Text style={[styles.breakdownValue, { color: '#ef4444' }]}>-R{vatAmount.toLocaleString('en-ZA')}</Text>
        </View>
        <View style={[styles.breakdownRow, styles.breakdownTotal]}>
          <Text style={[styles.breakdownLabel, { fontWeight: '800', color: '#0f172a' }]}>Talent payout</Text>
          <Text style={[styles.breakdownValue, { color: '#16a34a', fontWeight: '800' }]}>R{photographerPayout.toLocaleString('en-ZA')}</Text>
        </View>
        <Text style={styles.breakdownNote}>* Exact total calculated at checkout based on final scope. You will be charged R{estimatedBaseAmount.toLocaleString('en-ZA')}</Text>
      </View>

      <TouchableOpacity
        style={[styles.cta, submitting && { opacity: 0.7 }]}
        onPress={handleSubmit}
        disabled={submitting || !selectedDate}
        activeOpacity={submitting || !selectedDate ? 1 : 0.8}
      >
        <Text style={styles.ctaText}>{submitting ? 'Saving...' : isInstantBook ? 'Instant Book' : 'Send Request'}</Text>
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
  packageHint: {
    color: '#64748b',
    fontSize: 12,
    marginBottom: 10,
  },
  packageGrid: {
    gap: 12,
    marginBottom: 4,
  },
  packageCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    width: 200,
  },
  packageCardActive: {
    borderColor: '#0f172a',
    backgroundColor: '#fff7ed',
  },
  packageTitle: {
    color: '#0f172a',
    fontWeight: '800',
    fontSize: 14,
  },
  packageTitleActive: {
    color: '#0f172a',
  },
  packageDuration: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
  },
  packagePrice: {
    color: '#f97316',
    fontWeight: '800',
    marginTop: 6,
  },
  packageMetaActive: {
    color: '#475569',
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
  addonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  addonRowActive: {
  },
  addonLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addonLabel: {
    fontSize: 14,
    color: '#475569',
    fontWeight: '500',
  },
  addonLabelActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  addonPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f97316',
  },
  instantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  toggleSwitch: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#cbd5e1',
    padding: 2,
    justifyContent: 'center',
  },
  toggleSwitchActive: {
    backgroundColor: '#16a34a',
  },
  toggleKnob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  toggleKnobActive: {
    transform: [{ translateX: 20 }],
  },
});

export default BookingFormScreen;
