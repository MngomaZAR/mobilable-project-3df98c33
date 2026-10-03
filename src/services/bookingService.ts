import { backendDb } from './backendGateway';
import { Booking, BookingStatus } from '../types';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';
import { environment } from '../config/environment';

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
  idempotencyKey?: string;
  notes?: string;
  isInstant?: boolean;
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
    idempotency_key: params.idempotencyKey,
    notes: params.notes ?? '',
    is_instant: params.isInstant ?? false,
  };

  if (environment.backendProvider === 'api') {
    const token = await getApiAccessToken();
    return apiClient.post<Booking>('/bookings', payload, { token, timeoutMs: BOOKING_WRITE_TIMEOUT_MS });
  }

  const abort = createAbortSignal(BOOKING_WRITE_TIMEOUT_MS);
  try {
    const { data, error } = await Promise.race([
      backendDb
    .from('bookings')
    .insert(payload)
    .select('*')
        .single(),
      new Promise((_, reject) =>
        abort.signal.addEventListener('abort', () => reject(new Error('Booking request timed out. Check your connection and try again.')))
      ),
    ]) as { data: any; error: Error | null };

    if (error) throw error;
    return data;
  } finally {
    abort.clear();
  }
};

export const updateBookingStatusInDb = async (bookingId: string, status: BookingStatus) => {
  if (environment.backendProvider === 'api') {
    const token = await getApiAccessToken();
    return apiClient.patch<Booking>(`/bookings/${encodeURIComponent(bookingId)}`, { status }, { token });
  }
  const { data, error } = await backendDb
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
  const { data, error } = await backendDb
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
