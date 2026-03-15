import { supabase } from '../config/supabaseClient';
import { Booking, BookingStatus } from '../types';

export const createBookingRequest = async (params: {
  talentId: string;
  clientId: string;
  talentType: 'photographer' | 'model';
  packageId: string;
  totalAmount: number;
  latitude: number;
  longitude: number;
  startTime: string;
  endTime: string;
}) => {
  const { data, error } = await supabase
    .from('bookings')
    .insert({
      photographer_id: params.talentType === 'photographer' ? params.talentId : null,
      model_id: params.talentType === 'model' ? params.talentId : null,
      client_id: params.clientId,
      package_id: params.packageId,
      status: 'pending',
      total_amount: params.totalAmount,
      latitude: params.latitude,
      longitude: params.longitude,
      start_time: params.startTime,
      end_time: params.endTime,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
};

export const updateBookingStatusInDb = async (bookingId: string, status: BookingStatus) => {
  const { data, error } = await supabase
    .from('bookings')
    .update({ status })
    .eq('id', bookingId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
};
