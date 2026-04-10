import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useAppData } from '../store/AppDataContext';
import { RequestPopup } from './RequestPopup';
import { supabase } from '../config/supabaseClient';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { getBookingTalentColumnForRole, isProviderUser } from '../utils/userRole';

export const GlobalRequestManager: React.FC = () => {
  const { state } = useAppData();
  const [incomingRequest, setIncomingRequest] = useState<any | null>(null);
  const [showPopup, setShowPopup] = useState(false);
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const currentUser = state.currentUser;

  useEffect(() => {
    if (!currentUser?.id) return;

    if (!isProviderUser(currentUser)) return;

    const filterColumn = getBookingTalentColumnForRole(currentUser);
    
    // Subscribe to new booking requests for this talent
    const channel = supabase.channel(`global:bookings:${currentUser.id}`);

    channel.on(
      'postgres_changes',
      { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'bookings', 
        filter: `${filterColumn}=eq.${currentUser.id}` 
      },
      (payload) => {
        if (payload.new.status === 'pending') {
          setIncomingRequest(payload.new);
          setShowPopup(true);
        }
      }
    ).subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  const handleAccept = async () => {
    if (!incomingRequest) return;
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'accepted' })
        .eq('id', incomingRequest.id);
      
      if (error) throw error;
      
      setShowPopup(false);
      Alert.alert('Booking Accepted!', 'Redirecting to booking details...');
      navigation.navigate('BookingDetail', { bookingId: incomingRequest.id });
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleDecline = async () => {
    if (!incomingRequest) return;
    try {
      await supabase
        .from('bookings')
        .update({ status: 'declined' })
        .eq('id', incomingRequest.id);
      setShowPopup(false);
    } catch (err) {
      setShowPopup(false);
    }
  };

  if (!showPopup || !incomingRequest) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <RequestPopup
        visible={showPopup}
        requestData={incomingRequest}
        onAccept={handleAccept}
        onDecline={handleDecline}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    justifyContent: 'flex-start',
    paddingTop: 50,
  },
});
