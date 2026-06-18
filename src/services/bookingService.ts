import { supabase, supabasePublishableKey, supabaseRestUrl } from '../config/supabaseClient';
import { Booking, BookingStatus } from '../types';

const BOOKING_WRITE_TIMEOUT_MS = 20000;

const createAbortSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
};

export const createBookingRequest = async (params: {
  talentId: string;
  clientId: string;
  talentType: 'photographer' | 'model';
  serviceType?: 'photography' | 'modeling' | 'combined' | 'video_call';
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
  const payload = {
    photographer_id: params.talentType === 'photographer' ? params.talentId : null,
    model_id: params.talentType === 'model' ? params.talentId : null,
    client_id: params.clientId,
    service_type: params.serviceType ?? (params.talentType === 'model' ? 'modeling' : 'photography'),
    package_id: params.packageId,
    pricing_mode: 'flat',
    status: 'pending',
    user_latitude: params.latitude,
    user_longitude: params.longitude,
    start_datetime: params.startTime,
    end_datetime: params.endTime,
    price_total: params.totalAmount,
    fanout_count: params.fanoutCount ?? 1,
    intensity_level: params.intensityLevel ?? 1,
    quote_token: params.quoteToken ?? null,
    assignment_state: params.assignmentState ?? 'queued',
    dispatch_request_id: params.dispatchRequestId ?? null,
  };

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (supabaseRestUrl && supabasePublishableKey && accessToken) {
    const abort = createAbortSignal(BOOKING_WRITE_TIMEOUT_MS);
    try {
      const response = await fetch(`${supabaseRestUrl}/bookings?select=*`, {
        method: 'POST',
        signal: abort.signal,
        headers: {
          apikey: supabasePublishableKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
          'x-client-info': 'papzi-app',
        },
        body: JSON.stringify(payload),
      });

      const bodyText = await response.text();
      const body = bodyText ? JSON.parse(bodyText) : null;
      if (!response.ok) {
        const message = body?.message || body?.error || `Booking request failed (${response.status}).`;
        throw new Error(message);
      }
      const row = Array.isArray(body) ? body[0] : body;
      if (!row?.id) throw new Error('Booking request did not return a booking.');
      return row;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('Booking request timed out. Check your connection and try again.');
      }
      throw error;
    } finally {
      abort.clear();
    }
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert(payload)
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
