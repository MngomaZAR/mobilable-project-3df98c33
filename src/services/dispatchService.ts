import { requireCurrentAuthenticatedUser } from '../config/currentUser';
import { invokeBackendFunction } from '../config/backendFunctions';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';
import { backendDb } from './backendGateway';
import { AssignmentState, DispatchOffer, DispatchRequest, EquipmentProfile, EtaSnapshot, LeaderboardEntry, PricingQuote } from '../types';

export type DispatchServiceType = 'photography' | 'modeling';

export interface DispatchCreatePayload {
  booking_id: string;
  service_type?: DispatchServiceType;
  fanout_count: number;
  intensity_level: number;
  sla_timeout_seconds?: number;
  requested_lat?: number;
  requested_lng?: number;
  // Compatibility hint only. The stored booking/offer quote determines the price.
  base_amount?: number;
  required_tier?: string;
  required_equipment?: Partial<EquipmentProfile>;
  idempotency_key?: string;
}

// Legacy screen intents still contain these modes; reject them, never downgrade them.
type DispatchCreateInput = Omit<DispatchCreatePayload, 'service_type'> & {
  service_type?: DispatchRequest['service_type'];
};

export interface DispatchRespondPayload {
  dispatch_request_id: string;
  offer_id?: string;
  response: 'accept' | 'decline';
  idempotency_key?: string;
}

export type BookingDispatchOffer = DispatchOffer & {
  expires_at: string;
  quote: {
    currency: 'ZAR';
    total_amount: number;
    base_amount: number;
    equipment_amount: number;
    travel_amount: number;
    package_id: string | null;
    model_service_type: string | null;
    pricing_basis: string;
  };
};

export interface DispatchStateResponse {
  dispatch_request: Omit<DispatchRequest, 'booking_id' | 'service_type'> & {
    booking_id: string;
    service_type: DispatchServiceType;
  };
  offers: BookingDispatchOffer[];
  quote: PricingQuote & { currency: 'ZAR'; is_ceiling: boolean };
  events: Array<{ id: string; event_type: string; created_at: string; payload: Record<string, unknown> }>;
  assignment_state: AssignmentState;
  eta_confidence: number | null;
}

export type DispatchEtaSnapshot = Omit<EtaSnapshot, 'eta_seconds' | 'eta_minutes' | 'eta_confidence'> & {
  eta_seconds: number | null;
  eta_minutes: number | null;
  eta_confidence: number | null;
};

const requireToken = async () => {
  const token = await getApiAccessToken();
  if (typeof token !== 'string' || !token.trim()) throw new Error('Sign in to access dispatch.');
  return token;
};

const requireId = (value: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new Error('Provide a valid booking, dispatch or offer ID.');
  return value;
};

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid dispatch data.');
  return value as Record<string, unknown>;
};

const allowedKeys = (value: unknown, keys: string[]) => {
  if (Object.keys(object(value)).some(key => !keys.includes(key))) throw new Error('Unsupported dispatch command fields.');
};

const requireInteger = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid dispatch ${label}.`);
  return value;
};

const requireKey = (key: string | undefined) => {
  if (key !== undefined && (typeof key !== 'string' || key.length < 8 || key.length > 120 || !key.trim())) {
    throw new Error('Provide an idempotency key of 8 to 120 characters.');
  }
  return key;
};

const isMoney = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isText = (value: unknown) => typeof value === 'string' && Boolean(value.trim());
const isDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const ASSIGNMENT_STATES: AssignmentState[] = ['queued', 'offered', 'accepted', 'expired', 'cancelled'];

const validateOffer = (value: unknown, requestId: string): BookingDispatchOffer => {
  const offer = object(value);
  const quote = object(offer.quote);
  if (!isText(offer.id) || offer.dispatch_request_id !== requestId || !isText(offer.provider_id) ||
    !Number.isInteger(offer.offer_rank) || Number(offer.offer_rank) < 1 ||
    !['offered', 'accepted', 'declined', 'expired', 'cancelled'].includes(String(offer.status)) ||
    !isDate(offer.created_at) || !isDate(offer.expires_at) || quote.currency !== 'ZAR' ||
    !['total_amount', 'base_amount', 'equipment_amount', 'travel_amount'].every(key => isMoney(quote[key])) ||
    !isText(quote.pricing_basis)) throw new Error('The server returned an invalid dispatch offer.');
  return offer as unknown as BookingDispatchOffer;
};

const validateState = (value: unknown, expected: { bookingId?: string; requestId?: string }): DispatchStateResponse => {
  const data = object(value);
  const request = object(data.dispatch_request);
  const quote = object(data.quote);
  if (!isText(request.id) || !isText(request.booking_id) || !isText(request.client_id) ||
    (expected.bookingId !== undefined && request.booking_id !== expected.bookingId) ||
    (expected.requestId !== undefined && request.id !== expected.requestId) ||
    (request.service_type !== 'photography' && request.service_type !== 'modeling') ||
    !ASSIGNMENT_STATES.includes(request.status as AssignmentState) || data.assignment_state !== request.status ||
    !isDate(request.created_at) || !isDate(request.expires_at) ||
    !Array.isArray(data.offers) || !Array.isArray(data.events) ||
    quote.id !== request.id || quote.currency !== 'ZAR' || !isMoney(quote.total_amount) ||
    !isMoney(quote.base_amount) || !isMoney(quote.surge_multiplier) || !isMoney(quote.intensity_multiplier) ||
    !isText(quote.quote_token) || typeof quote.is_ceiling !== 'boolean' ||
    quote.is_ceiling !== (request.status !== 'accepted') ||
    quote.status !== (request.status === 'queued' || request.status === 'offered' ? 'preview' : request.status) ||
    (request.status === 'accepted' && !isText(request.assignment_profile_id)) ||
    !isDate(quote.created_at) || !isDate(quote.expires_at)) {
    throw new Error('The server returned an invalid booking-backed dispatch state.');
  }
  const offers = data.offers.map(offer => validateOffer(offer, String(request.id)));
  // Dispatch matching supplies no road route or arrival estimate, even when confidence is 0.
  return { ...data, offers, eta_confidence: null } as unknown as DispatchStateResponse;
};

export const createDispatch = async (payload: DispatchCreateInput): Promise<DispatchStateResponse> => {
  allowedKeys(payload, ['booking_id', 'service_type', 'fanout_count', 'intensity_level', 'sla_timeout_seconds',
    'requested_lat', 'requested_lng', 'base_amount', 'required_tier', 'required_equipment', 'idempotency_key']);
  const bookingId = requireId(payload.booking_id);
  if (payload.service_type !== undefined && payload.service_type !== 'photography' && payload.service_type !== 'modeling') {
    throw new Error('Instant dispatch supports photography or modeling only; combined and video calls are unavailable.');
  }
  if ((payload.requested_lat === undefined) !== (payload.requested_lng === undefined) ||
    (payload.requested_lat !== undefined && (!Number.isFinite(payload.requested_lat) || payload.requested_lat < -35 || payload.requested_lat > -22)) ||
    (payload.requested_lng !== undefined && (!Number.isFinite(payload.requested_lng) || payload.requested_lng < 16 || payload.requested_lng > 33))) {
    throw new Error('Provide both finite coordinates inside the ZA operational service region, or neither.');
  }
  if (payload.base_amount !== undefined && (!isMoney(payload.base_amount) || payload.base_amount > 10000000)) {
    throw new Error('Invalid dispatch compatibility price hint.');
  }
  if (payload.required_tier !== undefined && !isText(payload.required_tier)) throw new Error('Select a defined booking package.');
  let equipment: Partial<EquipmentProfile> | undefined;
  if (payload.required_equipment !== undefined) {
    const categories = ['camera', 'lenses', 'lighting', 'extras'] as const;
    allowedKeys(payload.required_equipment, [...categories]);
    equipment = {};
    for (const category of categories) {
      const selected = payload.required_equipment[category] ?? [];
      if (!Array.isArray(selected) || selected.length > 3 || selected.some(item => !isText(item)) || new Set(selected).size !== selected.length) {
        throw new Error('Select at most three unique equipment identifiers per category.');
      }
      equipment[category] = [...selected].sort();
    }
  }
  const command: DispatchCreatePayload = {
    booking_id: bookingId, service_type: payload.service_type,
    fanout_count: requireInteger(payload.fanout_count, 1, 20, 'fanout'),
    intensity_level: requireInteger(payload.intensity_level, 1, 5, 'intensity'),
    sla_timeout_seconds: requireInteger(payload.sla_timeout_seconds ?? 90, 15, 300, 'offer lifetime'),
    requested_lat: payload.requested_lat, requested_lng: payload.requested_lng,
    base_amount: payload.base_amount, required_tier: payload.required_tier, required_equipment: equipment,
    idempotency_key: requireKey(payload.idempotency_key),
  };
  const data = await apiClient.post<unknown>('/dispatch/requests', command, { token: await requireToken() });
  return validateState(data, { bookingId });
};

export const respondToDispatch = async (payload: DispatchRespondPayload): Promise<{ status: 'accepted' | 'declined'; offer: BookingDispatchOffer }> => {
  allowedKeys(payload, ['dispatch_request_id', 'offer_id', 'response', 'idempotency_key']);
  const requestId = requireId(payload.dispatch_request_id);
  if (payload.response !== 'accept' && payload.response !== 'decline') throw new Error('Accept or decline your own dispatch offer.');
  const command: DispatchRespondPayload = {
    dispatch_request_id: requestId, response: payload.response,
    offer_id: payload.offer_id === undefined ? undefined : requireId(payload.offer_id),
    idempotency_key: requireKey(payload.idempotency_key),
  };
  const data = object(await apiClient.post<unknown>('/dispatch/respond', command, { token: await requireToken() }));
  const offer = validateOffer(data.offer, requestId);
  const expectedStatus = payload.response === 'accept' ? 'accepted' : 'declined';
  if (data.status !== expectedStatus || offer.status !== expectedStatus ||
    (payload.offer_id !== undefined && offer.id !== payload.offer_id)) throw new Error('The server did not confirm this offer response.');
  return { status: expectedStatus, offer };
};

export const getDispatchState = async (dispatchRequestId: string): Promise<DispatchStateResponse> => {
  const requestId = requireId(dispatchRequestId);
  const data = await apiClient.get<unknown>(`/dispatch/requests/${encodeURIComponent(requestId)}`, { token: await requireToken() });
  return validateState(data, { requestId });
};

export const getEta = async (bookingId: string): Promise<DispatchEtaSnapshot> => {
  requireId(bookingId);
  // This API is currently disabled (503). Do not fall back to a legacy synthetic ETA.
  const data = object(await apiClient.post<unknown>('/functions/eta', { booking_id: bookingId }, { token: await requireToken() }));
  if (data.booking_id !== bookingId || !isText(data.source)) throw new Error('The server returned an invalid ETA snapshot.');
  if (data.source !== 'osrm' || data.eta_seconds === null || data.eta_seconds === undefined ||
    data.eta_minutes === null || data.eta_minutes === undefined) {
    return { ...data, eta_seconds: null, eta_minutes: null, eta_confidence: null, distance_km: null } as DispatchEtaSnapshot;
  }
  if (!isMoney(data.eta_seconds) || !isMoney(data.eta_minutes) ||
    typeof data.eta_confidence !== 'number' || !Number.isFinite(data.eta_confidence) || data.eta_confidence < 0 || data.eta_confidence > 1) {
    throw new Error('The server returned an invalid road-routing ETA.');
  }
  return data as unknown as DispatchEtaSnapshot;
};

export const getStatusLeaderboard = async (params?: { city?: string; limit?: number }) => {
  const { data, error } = await invokeBackendFunction('status-leaderboard', {
    city: params?.city,
    limit: params?.limit,
  });
  if (error) throw new Error(error.message || 'Unable to fetch status leaderboard.');
  return data as { city: string; source: string; generated_at: string; leaderboard: LeaderboardEntry[] };
};

export const getForYouRanking = async (params?: { limit?: number }) => {
  const { data, error } = await invokeBackendFunction('for-you-ranking', {
    limit: params?.limit,
  });
  if (error) throw new Error(error.message || 'Unable to fetch ranking.');
  return data as { ranked_posts: Array<{ post_id: string; score: number }>; generated_at: string };
};

export const recordRecommendationEvents = async (events: Array<{
  post_id: string;
  event_type: 'impression' | 'open' | 'like' | 'comment' | 'share' | 'unlock' | 'skip' | 'hide' | 'booking_conversion';
  dwell_ms?: number;
  metadata?: Record<string, any>;
}>) => {
  if (!events?.length) return { success: true, inserted: 0 };
  const { data, error } = await invokeBackendFunction('recommendation-events', {
    events,
  });
  if (error) throw new Error(error.message || 'Unable to record recommendation events.');
  return data as { success: boolean; inserted: number };
};

export const getHeatmap = async (params?: { role?: 'photographer' | 'model' | 'combined'; hours?: number; city?: string }) => {
  const { data, error } = await invokeBackendFunction('heatmap', {
    role: params?.role,
    hours: params?.hours,
    city: params?.city,
  });
  if (error) throw new Error(error.message || 'Unable to fetch heatmap.');
  return data as {
    generated_at: string;
    role: 'photographer' | 'model' | 'combined';
    city?: string | null;
    buckets: Array<{
      role: string;
      geohash: string;
      city?: string | null;
      bucket_start: string;
      online_count: number;
      demand_count: number;
      completed_count: number;
    }>;
  };
};

export const recordConsent = async (payload: {
  consent_type: string;
  enabled: boolean;
  legal_basis?: string;
  consent_version?: string;
  context?: Record<string, any>;
}) => {
  const user = await requireCurrentAuthenticatedUser().catch(() => null);
  const userId = user?.id;

  if (userId) {
    const nowIso = new Date().toISOString();
    const [eventRes, consentRes] = await Promise.all([
      backendDb.from('consent_events').insert({
        user_id: userId,
        consent_type: payload.consent_type,
        legal_basis: payload.legal_basis ?? 'consent',
        consent_version: payload.consent_version ?? null,
        enabled: Boolean(payload.enabled),
        context: payload.context ?? {},
        captured_at: nowIso,
      }),
      backendDb
        .from('user_consents')
        .upsert(
          {
            user_id: userId,
            consent_type: payload.consent_type,
            granted: Boolean(payload.enabled),
            accepted: Boolean(payload.enabled),
            granted_at: nowIso,
            accepted_at: nowIso,
            legal_basis: payload.legal_basis ?? 'consent',
            version: payload.consent_version ?? null,
            metadata: payload.context ?? {},
          },
          { onConflict: 'user_id,consent_type', ignoreDuplicates: true }
        ),
    ]);

    if (!eventRes.error && !consentRes.error) {
      return {
        success: true,
        consent_event: {
          user_id: userId,
          consent_type: payload.consent_type,
          legal_basis: payload.legal_basis ?? 'consent',
          consent_version: payload.consent_version ?? null,
          enabled: Boolean(payload.enabled),
          context: payload.context ?? {},
          captured_at: nowIso,
        },
        user_consent: {
          user_id: userId,
          consent_type: payload.consent_type,
          granted: Boolean(payload.enabled),
          accepted: Boolean(payload.enabled),
          granted_at: nowIso,
          accepted_at: nowIso,
          legal_basis: payload.legal_basis ?? 'consent',
          version: payload.consent_version ?? null,
          metadata: payload.context ?? {},
        },
      } as { success: boolean; consent_event: Record<string, any>; user_consent: Record<string, any> };
    }
  }

  const { data, error } = await invokeBackendFunction('compliance-consent', payload);
  if (error) throw new Error(error.message || 'Unable to record consent.');
  return data as { success: boolean; consent_event: Record<string, any>; user_consent: Record<string, any> };
};
