import { backendDb } from './backendGateway';
import { requireCurrentAuthenticatedUser } from '../config/currentUser';
import { environment } from '../config/environment';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';

export interface ReviewPayload {
  bookingId: string;
  photographerId: string;
  rating: number;
  comment?: string;
}

export interface ReviewRow {
  id: string;
  booking_id: string;
  client_id: string;
  photographer_id: string;
  rating: number;
  comment: string | null;
  moderation_status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface ReviewSummary {
  count: number;
  average: number | null;
}

export const fetchPublishedReviewSummary = async (creatorId: string): Promise<ReviewSummary> => {
  if (environment.backendProvider === 'api') {
    return apiClient.get<ReviewSummary>(`/reviews/summary/${encodeURIComponent(creatorId)}`);
  }
  // Legacy adapters must aggregate every page rather than claim the first 50 is the total.
  let count = 0;
  let sum = 0;
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await backendDb.from('reviews').select('rating')
      .eq('photographer_id', creatorId).eq('moderation_status', 'approved')
      .order('id', { ascending: true }).range(offset, offset + 199);
    if (error) throw new Error(error.message || 'Could not load published reviews.');
    for (const row of data ?? []) {
      const value = Number(row.rating);
      if (Number.isFinite(value) && value >= 1 && value <= 5) { count++; sum += value; }
    }
    if ((data ?? []).length < 200) break;
  }
  return { count, average: count ? Math.round(sum / count * 10) / 10 : null };
};

/** Submit a review for a completed booking */
export const createReview = async (payload: ReviewPayload): Promise<ReviewRow> => {
  const user = await requireCurrentAuthenticatedUser();
  if (environment.backendProvider === 'api') {
    return apiClient.post<ReviewRow>('/reviews', { booking_id: payload.bookingId, rating: payload.rating, comment: payload.comment ?? '' }, { token: await getApiAccessToken() });
  }

  const { data, error } = await backendDb
    .from('reviews')
    .insert({
      booking_id: payload.bookingId,
      client_id: user.id,
      photographer_id: payload.photographerId,
      rating: payload.rating,
      comment: payload.comment ?? null,
      moderation_status: 'pending',
    })
    .select()
    .single();

  if (error) throw new Error(error.message || 'Failed to submit review.');
  return data as ReviewRow;
};

/** Fetch all approved reviews for a given photographer or model */
export const fetchReviewsForUser = async (photographerId: string): Promise<ReviewRow[]> => {
  const { data, error } = await backendDb
    .from('reviews')
    .select('id, booking_id, client_id, photographer_id, rating, comment, moderation_status, created_at')
    .eq('photographer_id', photographerId)
    .eq('moderation_status', 'approved')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message || 'Failed to load reviews.');
  return (data ?? []) as ReviewRow[];
};

/** Fetch the average rating for a user */
export const fetchAverageRating = async (photographerId: string): Promise<number> => {
  return (await fetchPublishedReviewSummary(photographerId)).average ?? 0;
};
