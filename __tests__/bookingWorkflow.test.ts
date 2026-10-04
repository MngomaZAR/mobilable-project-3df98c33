import { Booking } from '../src/types';
import { canTrackBooking, getBookingChatTarget, isReviewableBooking } from '../src/utils/bookingWorkflow';

const booking: Booking = { id: 'booking-1', client_id: 'client', photographer_id: 'photographer', booking_date: '2026-10-20', package_type: 'Shoot', status: 'accepted', payment_status: 'unpaid', created_at: '2026-10-04', total_amount: 1200, commission_amount: 240, payout_amount: 960 };

test('each party chats with the other party, not themselves', () => {
  expect(getBookingChatTarget(booking, 'client')).toBe('photographer');
  expect(getBookingChatTarget(booking, 'photographer')).toBe('client');
  expect(getBookingChatTarget(booking, 'unrelated')).toBeNull();
  expect(getBookingChatTarget(booking)).toBeNull();
});

test('model booking chat resolves both directions without a photographer', () => {
  const modelBooking = { ...booking, photographer_id: '', model_id: 'model' };
  expect(getBookingChatTarget(modelBooking, 'client')).toBe('model');
  expect(getBookingChatTarget(modelBooking, 'model')).toBe('client');
});

test('tracking requires an active, paid booking', () => {
  expect(canTrackBooking(booking)).toBe(false);
  expect(canTrackBooking({ ...booking, payment_status: 'paid' })).toBe(true);
  for (const status of ['pending', 'cancelled', 'declined', 'completed'] as const) {
    expect(canTrackBooking({ ...booking, payment_status: 'paid', status })).toBe(false);
  }
});

test('a completed paid model booking is reviewable by its client', () => {
  const modelBooking = { ...booking, photographer_id: '', model_id: 'model', status: 'completed' as const, payment_status: 'paid' as const };
  expect(isReviewableBooking(modelBooking, 'client', 'model', 'booking-1')).toBe(true);
  expect(isReviewableBooking(modelBooking, 'client', 'model', 'different-booking')).toBe(false);
  expect(isReviewableBooking(modelBooking, 'model', 'model')).toBe(false);
  expect(isReviewableBooking(modelBooking, 'unrelated', 'model')).toBe(false);
  expect(isReviewableBooking({ ...modelBooking, payment_status: 'unpaid' }, 'client', 'model')).toBe(false);
});
