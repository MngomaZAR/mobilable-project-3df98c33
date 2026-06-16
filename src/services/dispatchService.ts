import { supabase } from '../config/supabaseClient';
import { requireCurrentAuthenticatedUser } from '../config/currentUser';
import { invokeBackendFunction } from '../config/backendFunctions';
import { DispatchOffer, DispatchRequest, EtaSnapshot, LeaderboardEntry, PricingQuote } from '../types';

export const createDispatch = async (payload: {
  booking_id?: string;
  service_type?: 'photography' | 'modeling' | 'combined' | 'video_call';
  fanout_count: number;
  intensity_level: number;
  sla_timeout_seconds?: number;
  requested_lat?: number;
  requested_lng?: number;
  base_amount?: number;
  required_tier?: string;
  required_equipment?: Record<string, string[]>;
}) => {
  const { data, error } = await invokeBackendFunction('dispatch-create', payload);
  if (error) throw new Error(error.message || 'Unable to create dispatch.');
  return data as {
    dispatch_request: DispatchRequest;
    offers: DispatchOffer[];
    quote: PricingQuote;
    assignment_state: string;
    eta_confidence: number;
  };
};

export const respondToDispatch = async (payload: {
  dispatch_request_id: string;
  offer_id?: string;
  response: 'accept' | 'decline';
  idempotency_key?: string;
}) => {
  const { data, error } = await invokeBackendFunction('dispatch-respond', payload);
  if (error) throw new Error(error.message || 'Unable to respond to dispatch.');
  return data as { status: 'accepted' | 'declined'; offer: DispatchOffer };
};

export const getDispatchState = async (dispatchRequestId: string) => {
  const { data, error } = await invokeBackendFunction('dispatch-state', {
    dispatch_request_id: dispatchRequestId,
  });
  if (error) throw new Error(error.message || 'Unable to fetch dispatch state.');
  return data as {
    dispatch_request: DispatchRequest;
    offers: DispatchOffer[];
    events: Array<Record<string, any>>;
    assignment_state: string;
    eta_confidence: number;
  };
};

export const getEta = async (bookingId: string) => {
  const { data, error } = await invokeBackendFunction('eta', {
    booking_id: bookingId,
  });
  if (error) throw new Error(error.message || 'Unable to fetch ETA.');
  return data as EtaSnapshot;
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
      supabase.from('consent_events').insert({
        user_id: userId,
        consent_type: payload.consent_type,
        legal_basis: payload.legal_basis ?? 'consent',
        consent_version: payload.consent_version ?? null,
        enabled: Boolean(payload.enabled),
        context: payload.context ?? {},
        captured_at: nowIso,
      }),
      supabase
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
