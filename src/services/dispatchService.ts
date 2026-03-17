import { supabase } from '../config/supabaseClient';
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
}) => {
  const { data, error } = await supabase.functions.invoke('dispatch-create', { body: payload });
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
  const { data, error } = await supabase.functions.invoke('dispatch-respond', { body: payload });
  if (error) throw new Error(error.message || 'Unable to respond to dispatch.');
  return data as { status: 'accepted' | 'declined'; offer: DispatchOffer };
};

export const getDispatchState = async (dispatchRequestId: string) => {
  const { data, error } = await supabase.functions.invoke('dispatch-state', {
    body: { dispatch_request_id: dispatchRequestId },
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
  const { data, error } = await supabase.functions.invoke('eta', {
    body: { booking_id: bookingId },
  });
  if (error) throw new Error(error.message || 'Unable to fetch ETA.');
  return data as EtaSnapshot;
};

export const getStatusLeaderboard = async (params?: { city?: string; limit?: number }) => {
  const { data, error } = await supabase.functions.invoke('status-leaderboard', {
    body: { city: params?.city, limit: params?.limit },
  });
  if (error) throw new Error(error.message || 'Unable to fetch status leaderboard.');
  return data as { city: string; source: string; generated_at: string; leaderboard: LeaderboardEntry[] };
};

export const getForYouRanking = async (params?: { limit?: number }) => {
  const { data, error } = await supabase.functions.invoke('for-you-ranking', {
    body: { limit: params?.limit },
  });
  if (error) throw new Error(error.message || 'Unable to fetch ranking.');
  return data as { ranked_posts: Array<{ post_id: string; score: number }>; generated_at: string };
};

export const getHeatmap = async (params?: { role?: 'photographer' | 'model' | 'combined'; hours?: number; city?: string }) => {
  const { data, error } = await supabase.functions.invoke('heatmap', {
    body: { role: params?.role, hours: params?.hours, city: params?.city },
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
  const { data, error } = await supabase.functions.invoke('compliance-consent', { body: payload });
  if (error) throw new Error(error.message || 'Unable to record consent.');
  return data as { success: boolean; consent_event: Record<string, any>; user_consent: Record<string, any> };
};
