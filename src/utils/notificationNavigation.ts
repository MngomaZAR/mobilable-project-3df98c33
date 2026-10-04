export const notificationDeepLink = (data: Record<string, unknown> | null, userId?: string): string | null => {
  if (!userId || !data || data.user_id !== userId) return null;
  const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 120 &&
    value === value.trim() && !Array.from(value).some(character => character.charCodeAt(0) < 32) ? value : null;
  const conversationId = id(data.conversation_id);
  const bookingId = id(data.booking_id);
  if (conversationId) return `papzi://chat/${encodeURIComponent(conversationId)}`;
  if (bookingId) return `papzi://booking/${encodeURIComponent(bookingId)}`;
  return null;
};
