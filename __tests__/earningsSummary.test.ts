import { summarizeRecordedEarnings } from '../src/utils/earningsSummary';
import { Booking, Earning } from '../src/types';

const booking = { id: 'shoot', status: 'accepted', total_amount: 1400, payout_amount: 1120 } as Booking;

test('unpaid accepted bookings are not recorded earnings', () => {
  expect(summarizeRecordedEarnings([], [booking]).net).toBe(0);
});

test('recorded ledger uses the actual booking quote, not a guessed commission', () => {
  const earning = { id: 'ledger', amount: 1120, source_id: 'shoot', source_type: 'booking' } as Earning;
  expect(summarizeRecordedEarnings([earning], [booking])).toEqual({ total: 1400, net: 1120, commission: 280, count: 1 });
});

test('missing quotes do not invent gross revenue or fees', () => {
  expect(summarizeRecordedEarnings([{ amount: 1120 } as Earning], [])).toEqual({ total: 1120, net: 1120, commission: 0, count: 1 });
});
