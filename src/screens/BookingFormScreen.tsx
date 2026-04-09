import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useMessaging } from '../store/MessagingContext';
import { BookingCalendar } from '../components/BookingCalendar';
import { Ionicons } from '@expo/vector-icons';
import { haversineDistanceKm } from '../utils/geo';
import { SERVICE_TYPES, TIER_OPTIONS, CAMERA_OPTIONS, LENS_OPTIONS, LIGHTING_OPTIONS, EXTRA_OPTIONS } from '../constants/bookingOptions';
import LocationPickerModal from '../components/LocationPickerModal';
import HowItWorksCard from '../components/HowItWorksCard';

type Route = RouteProp<RootStackParamList, 'BookingForm'>;
type Navigation = StackNavigationProp<RootStackParamList, 'BookingForm'>;
type PaymentDispatchIntent = NonNullable<RootStackParamList['Payment']['dispatchIntent']>;


const BookingFormScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, createBooking } = useAppData();
  const { startConversationWithUser } = useMessaging();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [timeSlot, setTimeSlot] = useState('Golden hour (4-7)');
  const [selectedServiceType, setSelectedServiceType] = useState<string | null>(null);
  const [selectedTierId, setSelectedTierId] = useState(TIER_OPTIONS[1]?.id ?? 'standard');
  const [bookingTimeMode, setBookingTimeMode] = useState<'now' | 'schedule'>('schedule');
  const [locationLabel, setLocationLabel] = useState(state.currentUser?.city ?? '');
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [distanceKm, setDistanceKm] = useState(0);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<Set<string>>(new Set());
  const [selectedLenses, setSelectedLenses] = useState<Set<string>>(new Set());
  const [selectedLighting, setSelectedLighting] = useState<Set<string>>(new Set());
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fanoutCount, setFanoutCount] = useState(1);
  const [intensityLevel, setIntensityLevel] = useState(1);

  const toggleSetValue = (set: Set<string>, setter: (next: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const bookingServiceType = params.serviceType ?? (params.modelId ? 'modeling' : 'photography');
  const talentId = bookingServiceType === 'modeling' ? params.modelId : params.photographerId;
  const isModelTalent = bookingServiceType === 'modeling';

  const talent = useMemo(
    () =>
      (isModelTalent ? state.models : state.photographers).find((item) => item.id === talentId) ||
      (isModelTalent ? state.photographers : state.models).find((item) => item.id === talentId),
    [isModelTalent, state.models, state.photographers, talentId]
  );

  const talentProfile = useMemo(
    () => (state.profiles ?? []).find((profile: any) => profile?.id === talent?.id),
    [state.profiles, talent?.id]
  );
  const talentKycApproved = Boolean(talentProfile?.kyc_status === 'approved' || talentProfile?.verified);
  const talentAgeVerified = Boolean(talentProfile?.age_verified);
  const canBookTalent = talentKycApproved && talentAgeVerified;

  const validationError = useMemo(() => {
    if (!selectedServiceType) return 'Select a service type to continue.';
    if (!selectedTierId) return 'Select a tier to continue.';
    if (selectedCamera.size === 0) return 'Select a camera requirement.';
    if (selectedLenses.size === 0) return 'Select a lens requirement.';
    if (selectedLighting.size === 0) return 'Select a lighting requirement.';
    if (!locationCoords) return 'Pick a location on the map or use GPS to continue.';
    if (bookingTimeMode === 'schedule' && !selectedDate) return 'Pick a date for your booking.';
    if (!canBookTalent) return 'This provider is not verified for bookings yet.';
    return null;
  }, [
    selectedServiceType,
    selectedTierId,
    selectedCamera,
    selectedLenses,
    selectedLighting,
    locationCoords,
    bookingTimeMode,
    selectedDate,
    canBookTalent,
  ]);

  React.useEffect(() => {
    if (!locationCoords || !talent) return;
    const km = haversineDistanceKm(
      { latitude: locationCoords.lat, longitude: locationCoords.lng },
      { latitude: talent.latitude, longitude: talent.longitude }
    );
    if (Number.isFinite(km)) {
      setDistanceKm(Math.max(0, Math.round(km)));
    }
  }, [locationCoords, talent?.latitude, talent?.longitude]);

  const formattedDate = useMemo(() => {
    if (bookingTimeMode === 'now') return 'Now (dispatch)';
    if (!selectedDate) return 'Pick a date and time slot below';
    return `${selectedDate.toDateString()} · ${timeSlot}`;
  }, [bookingTimeMode, selectedDate, timeSlot]);

  const selectedTier = useMemo(
    () => TIER_OPTIONS.find((tier) => tier.id === selectedTierId) ?? TIER_OPTIONS[0],
    [selectedTierId]
  );

  const selectedEquipmentTotal = useMemo(() => {
    const sumBy = (items: { id: string; price: number }[], selected: Set<string>) =>
      items.reduce((total, item) => (selected.has(item.id) ? total + item.price : total), 0);
    return (
      sumBy(CAMERA_OPTIONS, selectedCamera) +
      sumBy(LENS_OPTIONS, selectedLenses) +
      sumBy(LIGHTING_OPTIONS, selectedLighting) +
      sumBy(EXTRA_OPTIONS, selectedExtras)
    );
  }, [selectedCamera, selectedLenses, selectedLighting, selectedExtras]);

  /** Base rate in ZAR derived from tier + talent price range */
  const baseTierAmount = useMemo(() => {
    const level = ((talent?.price_range || '').match(/\$/g) || []).length || 2;
    const talentMultiplier = Math.max(0.85, level / 2);
    return Math.round(selectedTier.basePrice * talentMultiplier);
  }, [talent?.price_range, selectedTier.basePrice]);

  const serviceMultiplier = useMemo(() => {
    if (selectedServiceType === 'paparazzi') return 1.15;
    if (selectedServiceType === 'event') return 1.2;
    if (selectedServiceType === 'video') return 1.3;
    return 1;
  }, [selectedServiceType]);

  const serviceTypeLabel = useMemo(
    () => SERVICE_TYPES.find((service) => service.id === selectedServiceType)?.label ?? 'Service',
    [selectedServiceType]
  );

  const timeMultiplier = bookingTimeMode === 'now' ? 1.15 : 1;
  const timeAdjustment = Math.round(baseTierAmount * (timeMultiplier - 1));
  const serviceAdjustment = Math.round(baseTierAmount * (serviceMultiplier - 1));
  const travelAmount = Math.max(0, Math.round(distanceKm * 12));

  const priceBeforeExtras = baseTierAmount + serviceAdjustment + timeAdjustment;
  const estimatedTotalAmount = priceBeforeExtras + selectedEquipmentTotal + travelAmount;

  const estimatedRate = `From R${estimatedTotalAmount.toLocaleString('en-ZA')}`;
  const intensityMultiplier = useMemo(() => 1 + ((intensityLevel - 1) * 0.15) + ((fanoutCount - 1) * 0.05), [fanoutCount, intensityLevel]);
  const previewQuoteTotal = Math.round(estimatedTotalAmount * intensityMultiplier);
  const commissionAmount = Math.round(estimatedTotalAmount * 0.30);
  const vatAmount = Math.round(commissionAmount * 0.15);
  const photographerPayout = estimatedTotalAmount - commissionAmount - vatAmount;

  if (!talent) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This talent is no longer available.</Text>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (validationError) {
      Alert.alert('Complete your booking', validationError);
      return;
    }

    try {
      setSubmitting(true);
      const bookingDateSource = bookingTimeMode === 'now' ? new Date() : selectedDate!;
      const normalizedDate = new Date(bookingDateSource);
      normalizedDate.setUTCHours(12, 0, 0, 0);
      const bookingDate = normalizedDate.toISOString().split('T')[0];

      const equipmentSummary = [
        `Cameras: ${Array.from(selectedCamera).join(', ')}`,
        `Lenses: ${Array.from(selectedLenses).join(', ')}`,
        `Lighting: ${Array.from(selectedLighting).join(', ')}`,
        selectedExtras.size ? `Extras: ${Array.from(selectedExtras).join(', ')}` : null,
      ].filter(Boolean).join(' | ');

      const resolvedLocation = locationLabel.trim() || (locationCoords ? `${locationCoords.lat.toFixed(5)}, ${locationCoords.lng.toFixed(5)}` : '');
      const finalNotes = [
        `Service: ${serviceTypeLabel}`,
        `Tier: ${selectedTier.label}`,
        resolvedLocation ? `Location: ${resolvedLocation}` : null,
        `Distance: ${distanceKm} km`,
        `Time: ${bookingTimeMode === 'now' ? 'Now' : timeSlot}`,
        equipmentSummary,
        notes ? `Notes: ${notes}` : null,
      ].filter(Boolean).join('\n');

      const baseAmount = priceBeforeExtras + selectedEquipmentTotal;

      const booking = await createBooking({
        talent_id: talent.id,
        talent_type: isModelTalent ? 'model' : 'photographer',
        booking_date: bookingDate,
        package_type: `${serviceTypeLabel} • ${selectedTier.label} • ${bookingTimeMode === 'now' ? 'Now' : timeSlot}`,
        notes: finalNotes,
        base_amount: baseAmount,
        travel_amount: travelAmount,
        fanout_count: fanoutCount,
        intensity_level: intensityLevel,
        assignment_state: 'queued',
        latitude: locationCoords?.lat ?? talent.latitude,
        longitude: locationCoords?.lng ?? talent.longitude,
        start_datetime: bookingDateSource.toISOString(),
        end_datetime: new Date(bookingDateSource.getTime() + 60 * 60 * 1000).toISOString(),
      });

      const dispatchIntent: RootStackParamList['Payment']['dispatchIntent'] = bookingTimeMode === 'now'
        ? {
            serviceType: (isModelTalent ? 'modeling' : selectedServiceType === 'video' ? 'combined' : 'photography') as PaymentDispatchIntent['serviceType'],
            fanoutCount,
            intensityLevel,
            baseAmount: estimatedTotalAmount,
            requestedLat: locationCoords?.lat ?? talent.latitude,
            requestedLng: locationCoords?.lng ?? talent.longitude,
            tierId: selectedTier.id,
            locationLabel: resolvedLocation,
            equipment: {
              camera: Array.from(selectedCamera),
              lenses: Array.from(selectedLenses),
              lighting: Array.from(selectedLighting),
              extras: Array.from(selectedExtras),
            },
          }
        : undefined;

      Alert.alert(
        'Booking created',
        'Payment is required to dispatch your request.',
        [
          { text: 'Continue to payment', onPress: () => navigation.replace('Payment', { bookingId: booking.id, dispatchIntent }) },
        ]
      );
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
        <Text style={styles.heroMeta}>{talent.style} · {talent.location}</Text>
        <View style={styles.heroFooter}>
          <Text style={styles.heroPrice}>{estimatedRate}</Text>
          <TouchableOpacity style={styles.msgBadge} onPress={handleMessage}>
            <Ionicons name="chatbubble-outline" size={16} color="#fbbf24" />
            <Text style={styles.msgBadgeText}>Message</Text>
          </TouchableOpacity>
        </View>
      </View>
      {!canBookTalent ? (
        <View style={styles.blockedCard}>
          <Ionicons name="alert-circle" size={18} color="#ef4444" />
          <Text style={styles.blockedText}>This provider is not verified yet. Booking is disabled until KYC approval.</Text>
        </View>
      ) : null}

      <Text style={styles.label}>Talent</Text>
      <Text style={styles.value}>{talent.name}</Text>

      <Text style={styles.label}>Service type</Text>
      <View style={styles.choiceGrid}>
        {SERVICE_TYPES.map((service) => {
          const active = selectedServiceType === service.id;
          return (
            <TouchableOpacity
              key={service.id}
              style={[styles.choicePill, active && styles.choicePillActive]}
              onPress={() => { Haptics.selectionAsync(); setSelectedServiceType(service.id); }}
            >
              <Text style={[styles.choiceTitle, active && styles.choiceTitleActive]}>{service.label}</Text>
              <Text style={[styles.choiceSubtitle, active && styles.choiceSubtitleActive]}>{service.detail}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.detailsCard}>
        <Text style={styles.label}>Tier</Text>
        <Text style={styles.packageHint}>Select the service tier that matches your budget.</Text>
        <View style={styles.tierGrid}>
          {TIER_OPTIONS.map((tier) => {
            const active = tier.id === selectedTierId;
            return (
              <TouchableOpacity
                key={tier.id}
                style={[styles.tierCard, active && styles.tierCardActive]}
                onPress={() => { Haptics.selectionAsync(); setSelectedTierId(tier.id); }}
              >
                <Text style={[styles.tierTitle, active && styles.tierTitleActive]}>{tier.label}</Text>
                <Text style={[styles.tierMeta, active && styles.tierMetaActive]}>{tier.summary}</Text>
                <Text style={[styles.tierPrice, active && styles.tierTitleActive]}>From R{tier.basePrice.toLocaleString('en-ZA')}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.detailsCard}>
        <Text style={styles.label}>Equipment requirements</Text>
        <Text style={styles.packageHint}>All equipment sections are required to continue.</Text>
        <Text style={styles.equipmentLabel}>Camera</Text>
        <View style={styles.equipmentRow}>
          {CAMERA_OPTIONS.map(option => {
            const active = selectedCamera.has(option.id);
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.equipmentPill, active && styles.equipmentPillActive]}
                onPress={() => { Haptics.selectionAsync(); toggleSetValue(selectedCamera, setSelectedCamera, option.id); }}
              >
                <Text style={[styles.equipmentText, active && styles.equipmentTextActive]}>{option.label}</Text>
                <Text style={[styles.equipmentPrice, active && styles.equipmentTextActive]}>+R{option.price}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.equipmentLabel}>Lenses</Text>
        <View style={styles.equipmentRow}>
          {LENS_OPTIONS.map(option => {
            const active = selectedLenses.has(option.id);
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.equipmentPill, active && styles.equipmentPillActive]}
                onPress={() => { Haptics.selectionAsync(); toggleSetValue(selectedLenses, setSelectedLenses, option.id); }}
              >
                <Text style={[styles.equipmentText, active && styles.equipmentTextActive]}>{option.label}</Text>
                <Text style={[styles.equipmentPrice, active && styles.equipmentTextActive]}>+R{option.price}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.equipmentLabel}>Lighting</Text>
        <View style={styles.equipmentRow}>
          {LIGHTING_OPTIONS.map(option => {
            const active = selectedLighting.has(option.id);
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.equipmentPill, active && styles.equipmentPillActive]}
                onPress={() => { Haptics.selectionAsync(); toggleSetValue(selectedLighting, setSelectedLighting, option.id); }}
              >
                <Text style={[styles.equipmentText, active && styles.equipmentTextActive]}>{option.label}</Text>
                <Text style={[styles.equipmentPrice, active && styles.equipmentTextActive]}>+R{option.price}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.equipmentLabel}>Extras</Text>
        <View style={styles.equipmentRow}>
          {EXTRA_OPTIONS.map(option => {
            const active = selectedExtras.has(option.id);
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.equipmentPill, active && styles.equipmentPillActive]}
                onPress={() => { Haptics.selectionAsync(); toggleSetValue(selectedExtras, setSelectedExtras, option.id); }}
              >
                <Text style={[styles.equipmentText, active && styles.equipmentTextActive]}>{option.label}</Text>
                <Text style={[styles.equipmentPrice, active && styles.equipmentTextActive]}>+R{option.price}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.detailsCard}>
        <Text style={styles.label}>Time</Text>
        <View style={styles.choiceRow}>
          <TouchableOpacity
            style={[styles.choiceChip, bookingTimeMode === 'now' && styles.choiceChipActive]}
            onPress={() => { Haptics.selectionAsync(); setBookingTimeMode('now'); }}
          >
            <Text style={[styles.choiceChipText, bookingTimeMode === 'now' && styles.choiceChipTextActive]}>Now</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.choiceChip, bookingTimeMode === 'schedule' && styles.choiceChipActive]}
            onPress={() => { Haptics.selectionAsync(); setBookingTimeMode('schedule'); }}
          >
            <Text style={[styles.choiceChipText, bookingTimeMode === 'schedule' && styles.choiceChipTextActive]}>Schedule</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.selectedDate}>
          <Text style={styles.selectedDateText}>{formattedDate}</Text>
        </View>
        {bookingTimeMode === 'schedule' ? (
          <BookingCalendar value={selectedDate} onChange={setSelectedDate} timeSlot={timeSlot} onTimeChange={setTimeSlot} />
        ) : (
          <View style={styles.dispatchConfig}>
            <Text style={styles.dispatchTitle}>Dispatch settings</Text>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Paparazzi fanout</Text>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => setFanoutCount(v => Math.max(1, v - 1))}>
                  <Text style={styles.stepperText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{fanoutCount}</Text>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => setFanoutCount(v => Math.min(5, v + 1))}>
                  <Text style={styles.stepperText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Scene intensity</Text>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => setIntensityLevel(v => Math.max(1, v - 1))}>
                  <Text style={styles.stepperText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{intensityLevel}</Text>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => setIntensityLevel(v => Math.min(5, v + 1))}>
                  <Text style={styles.stepperText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.dispatchQuote}>Preview quote: R{previewQuoteTotal.toLocaleString('en-ZA')} ({intensityMultiplier.toFixed(2)}x)</Text>
          </View>
        )}
      </View>

      <View style={styles.detailsCard}>
        <Text style={styles.label}>Location</Text>
        <TextInput
          placeholder="Enter location"
          value={locationLabel}
          onChangeText={setLocationLabel}
          style={[styles.input, styles.locationInput]}
        />
        <TouchableOpacity style={styles.mapPickerButton} onPress={() => setLocationPickerOpen(true)}>
          <Ionicons name="map-outline" size={16} color="#0f172a" />
          <Text style={styles.mapPickerText}>Pick on map</Text>
        </TouchableOpacity>
        <View style={styles.locationRow}>
          <Text style={styles.packageHint}>Distance (km)</Text>
          <TextInput
            placeholder="0"
            value={String(distanceKm)}
            onChangeText={(val) => setDistanceKm(Number(val.replace(/[^0-9]/g, '') || 0))}
            keyboardType="numeric"
            style={[styles.input, styles.distanceInput]}
          />
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
          <Text style={styles.breakdownLabel}>Tier base</Text>
          <Text style={styles.breakdownValue}>R{baseTierAmount.toLocaleString('en-ZA')}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Service type</Text>
          <Text style={styles.breakdownValue}>R{serviceAdjustment.toLocaleString('en-ZA')}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Time / dispatch</Text>
          <Text style={styles.breakdownValue}>R{timeAdjustment.toLocaleString('en-ZA')}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Equipment</Text>
          <Text style={styles.breakdownValue}>R{selectedEquipmentTotal.toLocaleString('en-ZA')}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Travel</Text>
          <Text style={styles.breakdownValue}>R{travelAmount.toLocaleString('en-ZA')}</Text>
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
        <Text style={styles.breakdownNote}>* Exact total calculated at checkout based on final scope. You will be charged R{estimatedTotalAmount.toLocaleString('en-ZA')}</Text>
      </View>

      <View style={{ marginTop: 12 }}>
        <HowItWorksCard
          title="How Booking Works"
          persistKey="booking-form-how"
          items={[
            'Select every requirement: service type, tier, equipment, time, and location.',
            'Payment is required before dispatch and confirmation can begin.',
            'Instant requests fan out offers and the first accepted offer wins.',
            'Cancellation and refund timing is shown on your booking detail screen.',
          ]}
        />
      </View>

      {validationError ? (
        <Text style={styles.validationText}>{validationError}</Text>
      ) : null}

      <TouchableOpacity
        style={[styles.cta, (submitting || !!validationError) && { opacity: 0.7 }]}
        onPress={handleSubmit}
        disabled={submitting || !!validationError}
        activeOpacity={submitting || !!validationError ? 1 : 0.8}
      >
        <Text style={styles.ctaText}>{submitting ? 'Saving...' : 'Confirm Booking'}</Text>
      </TouchableOpacity>

      <LocationPickerModal
        visible={locationPickerOpen}
        initialCoords={locationCoords ?? undefined}
        initialLabel={locationLabel}
        onClose={() => setLocationPickerOpen(false)}
        onSelect={(result) => {
          setLocationCoords(result.coords);
          if (result.label) setLocationLabel(result.label);
          setLocationPickerOpen(false);
        }}
      />
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
  blockedCard: {
    marginTop: 8,
    marginBottom: 6,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fee2e2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fecaca',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  blockedText: {
    color: '#b91c1c',
    fontWeight: '700',
    flex: 1,
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
  choiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  choicePill: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f8fafc',
  },
  choicePillActive: {
    borderColor: '#0f172a',
    backgroundColor: '#fff7ed',
  },
  choiceTitle: {
    fontWeight: '800',
    color: '#0f172a',
    fontSize: 14,
  },
  choiceTitleActive: {
    color: '#0f172a',
  },
  choiceSubtitle: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
  },
  choiceSubtitleActive: {
    color: '#475569',
  },
  tierGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tierCard: {
    width: '48%',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  tierCardActive: {
    borderColor: '#0f172a',
    backgroundColor: '#fff7ed',
  },
  tierTitle: {
    fontWeight: '800',
    color: '#0f172a',
  },
  tierTitleActive: {
    color: '#0f172a',
  },
  tierMeta: {
    color: '#64748b',
    marginTop: 4,
    fontSize: 12,
  },
  tierMetaActive: {
    color: '#475569',
  },
  tierPrice: {
    color: '#f97316',
    fontWeight: '800',
    marginTop: 6,
  },
  equipmentLabel: {
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 8,
  },
  equipmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  equipmentPill: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#f8fafc',
    minWidth: '46%',
  },
  equipmentPillActive: {
    borderColor: '#0f172a',
    backgroundColor: '#fff7ed',
  },
  equipmentText: {
    fontWeight: '700',
    color: '#0f172a',
    fontSize: 12,
  },
  equipmentTextActive: {
    color: '#0f172a',
  },
  equipmentPrice: {
    color: '#f97316',
    fontWeight: '700',
    marginTop: 4,
    fontSize: 12,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  choiceChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  choiceChipActive: {
    borderColor: '#0f172a',
    backgroundColor: '#fff7ed',
  },
  choiceChipText: {
    fontWeight: '700',
    color: '#64748b',
  },
  choiceChipTextActive: {
    color: '#0f172a',
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
  packageMeta: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 16,
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
  locationInput: {
    marginBottom: 10,
  },
  mapPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e2e8f0',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  mapPickerText: {
    fontWeight: '700',
    color: '#0f172a',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  distanceInput: {
    width: 110,
    textAlign: 'center',
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
  validationText: {
    marginTop: 10,
    color: '#b91c1c',
    fontWeight: '700',
    textAlign: 'center',
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
  dispatchConfig: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    gap: 10,
  },
  dispatchTitle: {
    fontWeight: '700',
    color: '#0f172a',
  },
  configRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  configLabel: {
    color: '#334155',
    fontWeight: '600',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepperBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 20,
  },
  stepperValue: {
    width: 24,
    textAlign: 'center',
    fontWeight: '700',
    color: '#0f172a',
  },
  dispatchQuote: {
    color: '#0f172a',
    fontWeight: '700',
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


