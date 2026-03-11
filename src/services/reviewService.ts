import { supabase } from '../config/supabaseClient';

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

/** Submit a review for a completed booking */
export const createReview = async (payload: ReviewPayload): Promise<ReviewRow> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be logged in to leave a review.');

  const { data, error } = await supabase
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
  const { data, error } = await supabase
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
  const reviews = await fetchReviewsForUser(photographerId);
  if (!reviews.length) return 0;
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return Math.round((sum / reviews.length) * 10) / 10;
};
