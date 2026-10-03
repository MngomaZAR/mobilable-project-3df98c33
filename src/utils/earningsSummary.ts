import { Booking, Earning } from '../types';

export const summarizeRecordedEarnings = (rows: Earning[], bookings: Booking[]) => {
  const byId = new Map(bookings.map(booking => [booking.id, booking]));
  return rows.reduce((summary, row) => {
    const record = row as Earning & { booking_id?: string; status?: string; gross_amount?: number };
    if (record.status === 'cancelled' || record.status === 'reversed') return summary;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) return summary;
    const booking = byId.get(record.booking_id ?? row.source_id);
    const gross = Number(record.gross_amount ?? booking?.total_amount ?? amount);
    return {
      total: summary.total + (Number.isFinite(gross) ? gross : amount),
      net: summary.net + amount,
      commission: summary.commission + (Number.isFinite(gross) ? gross - amount : 0),
      count: summary.count + 1,
    };
  }, { total: 0, net: 0, commission: 0, count: 0 });
};
