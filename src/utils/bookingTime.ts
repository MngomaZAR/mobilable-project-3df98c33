const SLOT_HOURS: Record<string, number> = {
  'Morning (8-11)': 8,
  'Afternoon (12-3)': 12,
  'Golden hour (4-7)': 16,
  'Evening (7-9)': 19,
};

export const scheduledShootStart = (day: Date, slot: string): Date => {
  const hour = SLOT_HOURS[slot];
  if (hour === undefined) throw new Error('Choose a valid shoot time.');
  // Calendar days and service availability use South African time (UTC+2).
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour - 2));
};
