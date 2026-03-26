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
  fanoutCount?: number;
  intensityLevel?: number;
  quoteToken?: string;
  assignmentState?: 'queued' | 'offered' | 'accepted' | 'expired' | 'cancelled';
  dispatchRequestId?: string | null;
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
      price_total: params.totalAmount,
      user_latitude: params.latitude,
      user_longitude: params.longitude,
      start_datetime: params.startTime,
      end_datetime: params.endTime,
      fanout_count: params.fanoutCount ?? 1,
      intensity_level: params.intensityLevel ?? 1,
      quote_token: params.quoteToken ?? null,
      assignment_state: params.assignmentState ?? 'queued',
      dispatch_request_id: params.dispatchRequestId ?? null,
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

export const updateBookingDispatchInDb = async (bookingId: string, payload: {
  dispatch_request_id?: string | null;
  assignment_state?: 'queued' | 'offered' | 'accepted' | 'expired' | 'cancelled';
  quote_token?: string | null;
  eta_confidence?: number | null;
}) => {
  const { data, error } = await supabase
    .from('bookings')
    .update({
      dispatch_request_id: payload.dispatch_request_id ?? null,
      assignment_state: payload.assignment_state ?? 'queued',
      quote_token: payload.quote_token ?? null,
      eta_confidence: payload.eta_confidence ?? null,
    })
    .eq('id', bookingId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
};
