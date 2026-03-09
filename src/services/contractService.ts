import { supabase } from '../config/supabaseClient';

export interface Contract {
  id: string;
  booking_id: string;
  creator_id: string;
  client_id: string;
  model_id?: string | null;
  status: 'draft' | 'signed' | 'expired';
  contract_type: 'model_release' | 'shoot_agreement';
  content: string;
  creator_signature?: string | null;
  client_signature?: string | null;
  model_signature?: string | null;
  signed_at?: string | null;
  created_at: string;
}

export const fetchBookingContracts = async (bookingId: string) => {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('booking_id', bookingId);
    
  if (error) throw error;
  return data as Contract[];
};

export const createContract = async (bookingId: string, type: 'model_release' | 'shoot_agreement', content: string) => {
  // Fetch booking details to get participants
  const { data: booking, error: bError } = await supabase
    .from('bookings')
    .select('photographer_id, client_id, model_id')
    .eq('id', bookingId)
    .single();
    
  if (bError) throw bError;

  const { data, error } = await supabase
    .from('contracts')
    .insert({
      booking_id: bookingId,
      creator_id: booking.photographer_id,
      client_id: booking.client_id,
      model_id: booking.model_id,
      contract_type: type,
      content,
      status: 'draft'
    })
    .select()
    .single();

  if (error) throw error;
  return data as Contract;
};

export const signContract = async (contractId: string, signature: string, role: 'creator' | 'client' | 'model') => {
  const update: any = { status: 'signed', signed_at: new Date().toISOString() };
  if (role === 'creator') update.creator_signature = signature;
  if (role === 'client') update.client_signature = signature;
  if (role === 'model') update.model_signature = signature;

  const { error } = await supabase
    .from('contracts')
    .update(update)
    .eq('id', contractId);

  if (error) throw error;
};
