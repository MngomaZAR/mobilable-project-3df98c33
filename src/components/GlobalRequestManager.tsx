import React, { useEffect, useRef, useState } from 'react';
import { Alert, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';
import { RequestPopup } from './RequestPopup';
import { RootStackParamList } from '../navigation/types';
import { getBookingTalentColumnForRole, isProviderUser } from '../utils/userRole';
import { BookingStatus } from '../types';

export const GlobalRequestManager: React.FC = () => {
  const { state, updateBookingStatus } = useAppData();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const processing = useRef(false);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const currentUser = state.currentUser;

  useEffect(() => { setDismissed(new Set()); }, [currentUser?.id]);
  const talentColumn = currentUser ? getBookingTalentColumnForRole(currentUser) : null;
  const incomingRequest = currentUser && isProviderUser(currentUser) && talentColumn
    ? state.bookings.find(booking => booking[talentColumn] === currentUser.id &&
        booking.status === 'pending' && !dismissed.has(booking.id))
    : undefined;

  const dismiss = () => {
    if (incomingRequest) setDismissed(previous => new Set([...previous, incomingRequest.id]));
  };
  const respond = async (status: BookingStatus) => {
    if (!incomingRequest || processing.current) return;
    processing.current = true;
    setBusy(true);
    try {
      const saved = await updateBookingStatus(incomingRequest.id, status);
      if (!saved) throw new Error('This request is no longer available. Refresh your bookings.');
      dismiss();
      if (status === 'accepted') navigation.navigate('BookingDetail', { bookingId: incomingRequest.id });
    } catch (error) {
      Alert.alert('Unable to update request', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      processing.current = false;
      setBusy(false);
    }
  };

  if (!incomingRequest) return null;
  return (
    <View style={[styles.overlay, { top: insets.top + 8 }]} pointerEvents="box-none">
      <RequestPopup visible requestData={incomingRequest} busy={busy}
        onAccept={() => { void respond('accepted'); }}
        onDecline={() => { void respond('declined'); }} onDismiss={dismiss} />
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 99999 },
});
