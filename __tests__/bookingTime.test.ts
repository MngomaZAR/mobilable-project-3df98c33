import { formatBookingStart, scheduledShootStart } from '../src/utils/bookingTime';

describe('South African shoot times', () => {
  it('renders the chosen slot in the shoot timezone and does not invent a legacy midnight time', () => {
    expect(formatBookingStart({ booking_date: '2026-10-14', start_datetime: '2026-10-14T14:00:00Z' })).toContain('16:00 SAST');
    expect(formatBookingStart({ booking_date: '2026-10-14' })).not.toContain(':');
    expect(formatBookingStart({ booking_date: 'invalid' })).toBe('Date unavailable');
  });
  it('uses the selected calendar day and time rather than midnight', () => {
    const date = new Date('2026-10-10T00:00:00.000Z');
    expect(scheduledShootStart(date, 'Morning (8-11)').toISOString()).toBe('2026-10-10T06:00:00.000Z');
    expect(scheduledShootStart(date, 'Golden hour (4-7)').toISOString()).toBe('2026-10-10T14:00:00.000Z');
  });
  it('rejects unknown slots', () => {
    expect(() => scheduledShootStart(new Date(), 'unknown')).toThrow('Choose a valid shoot time.');
  });
});
