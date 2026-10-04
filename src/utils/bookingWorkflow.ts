import { Booking } from '../types';

export const getBookingProviderId = (booking: Booking) => booking.model_id || booking.photographer_id;

export const getBookingChatTarget = (booking: Booking, viewerId?: string): string | null => {
  const providerId = getBookingProviderId(booking);
  if (viewerId === booking.client_id) return providerId || null;
  if (viewerId === providerId) return booking.client_id;
  return null;
};

export const isReviewableBooking = (booking: Booking, viewerId: string | undefined, providerId: string, bookingId?: string) =>
  booking.client_id === viewerId && getBookingProviderId(booking) === providerId &&
  (!bookingId || booking.id === bookingId) && booking.payment_status === 'paid' &&
  (booking.status === 'completed' || booking.status === 'reviewed');

export const canTrackBooking = (booking: Booking) =>
  booking.payment_status === 'paid' && (booking.status === 'accepted' || booking.status === 'in_progress');
