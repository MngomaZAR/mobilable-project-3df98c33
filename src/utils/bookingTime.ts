const SLOT_HOURS: Record<string, number> = {
  'Morning (8-11)': 8,
  'Afternoon (12-3)': 12,
  'Golden hour (4-7)': 16,
  'Evening (7-9)': 19,
};

export const formatBookingStart = (booking: { start_datetime?: string; booking_date: string }): string => {
  const value = booking.start_datetime || booking.booking_date;
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'Date unavailable';
  const hasTime = !!booking.start_datetime || value.includes('T');
  const formatted = new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium', timeStyle: hasTime ? 'short' : undefined,
    timeZone: 'Africa/Johannesburg',
  }).format(date);
  return hasTime ? `${formatted} SAST` : formatted;
};

export const scheduledShootStart = (day: Date, slot: string): Date => {
  const hour = SLOT_HOURS[slot];
  if (hour === undefined) throw new Error('Choose a valid shoot time.');
  // Calendar days and service availability use South African time (UTC+2).
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour - 2));
};
