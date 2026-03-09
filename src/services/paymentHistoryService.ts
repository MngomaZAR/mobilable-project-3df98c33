import { supabase } from '../config/supabaseClient';

export interface PaymentRow {
  id: string;
  booking_id: string;
  customer_id: string;
  amount: number;
  currency: string;
  description: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  provider: string;
  provider_payment_id: string | null;
  created_at: string;
  processed_at: string | null;
}

/** Fetch all payments for the current user (as customer) */
export const fetchMyPayments = async (): Promise<PaymentRow[]> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('payments')
    .select('id, booking_id, customer_id, amount, currency, description, status, provider, provider_payment_id, created_at, processed_at')
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message || 'Failed to load payment history.');
  return (data ?? []) as PaymentRow[];
};

/** Fetch a single payment by booking ID */
export const fetchPaymentForBooking = async (bookingId: string): Promise<PaymentRow | null> => {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Failed to load payment.');
  return data as PaymentRow | null;
};
