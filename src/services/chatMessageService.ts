// ============================================================
// FILE: src/services/chatMessageService.ts
// COMPLETE REPLACEMENT
// Fixes: wrong column names, aligns with live DB schema
// DB schema: messages has columns:
//   id, conversation_id, chat_id, sender_id, text, body, content,
//   message_type, media_url, created_at, booking_id
// ============================================================

import { supabase } from '../config/supabaseClient';

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  message_type: 'text' | 'media';
  media_url: string | null;
  preview_url: string | null;
  locked: boolean;
  unlocked: boolean;
  unlock_booking_id: string | null;
  unlock_price: number | null;
  timestamp: string;
};

// ── List messages for a conversation ──────────────────────────
export const listConversationMessages = async (
  conversationId: string
): Promise<MessageRow[]> => {
  // Use the edge function which has service-role access and checks participation
  const { data, error } = await supabase.functions.invoke('chat-messages', {
    body: {
      action: 'list',
      conversation_id: conversationId,
    },
  });

  if (error) throw new Error(error.message || 'Failed to list messages.');

  // Edge function returns { messages: [...] } with camelCase keys
  const messages = data?.messages ?? [];

  return messages.map((msg: any) => ({
    id: msg.id,
    conversation_id: msg.chatId ?? msg.chat_id ?? msg.conversation_id ?? conversationId,
    sender_id: msg.senderId ?? msg.sender_id,
    body: msg.body ?? msg.text ?? '',
    message_type: msg.messageType ?? msg.message_type ?? 'text',
    media_url: msg.mediaUrl ?? msg.media_url ?? null,
    preview_url: msg.previewUrl ?? msg.preview_url ?? null,
    locked: msg.locked ?? false,
    unlocked: msg.unlocked ?? true,
    unlock_booking_id: msg.unlockBookingId ?? msg.unlock_booking_id ?? null,
    unlock_price: msg.unlockPrice ?? msg.unlock_price ?? null,
    timestamp: msg.timestamp ?? msg.created_at ?? new Date().toISOString(),
  }));
};

// ── Send a text message ────────────────────────────────────────
export const sendConversationTextMessage = async ({
  conversationId,
  text,
}: {
  conversationId: string;
  text: string;
}): Promise<MessageRow> => {
  // BUG FIX: Use the Edge Function which handles auth + DB insert correctly
  const { data, error } = await supabase.functions.invoke('chat-messages', {
    body: {
      action: 'send',
      conversation_id: conversationId,
      text,
      message_type: 'text',
    },
  });

  if (error) throw new Error(error.message || 'Failed to send message.');

  // Edge function wraps response in { message: {...} } with camelCase keys
  const msg = data?.message ?? data;
  if (!msg?.id) throw new Error('Message service did not return a valid message.');

  return {
    id: msg.id,
    conversation_id: msg.chatId ?? msg.chat_id ?? msg.conversation_id ?? conversationId,
    sender_id: msg.senderId ?? msg.senderId,
    body: msg.body ?? msg.text ?? text,
    message_type: msg.message_type ?? msg.messageType ?? 'text',
    media_url: msg.media_url ?? msg.mediaUrl ?? null,
    preview_url: msg.preview_url ?? msg.previewUrl ?? null,
    locked: msg.locked ?? false,
    unlocked: msg.unlocked ?? true,
    unlock_booking_id: msg.unlock_booking_id ?? msg.unlockBookingId ?? null,
    unlock_price: msg.unlock_price ?? msg.unlockPrice ?? null,
    timestamp: msg.created_at ?? msg.timestamp ?? new Date().toISOString(),
  };
};

// ── Send a locked media message ────────────────────────────────
export const sendConversationLockedMediaMessage = async ({
  conversationId,
  mediaUrl,
  previewUrl,
  text,
  unlockBookingId,
  unlockPrice,
}: {
  conversationId: string;
  mediaUrl: string;
  previewUrl?: string;
  text?: string;
  unlockBookingId?: string;
  unlockPrice?: number;
}): Promise<MessageRow> => {
  const { data, error } = await supabase.functions.invoke('chat-messages', {
    body: {
      action: 'send',
      conversation_id: conversationId,
      text: text ?? 'Shared a locked photo',
      message_type: 'media',
      media_url: mediaUrl,
      preview_url: previewUrl,
      locked: true,
      unlock_booking_id: unlockBookingId,
      unlock_price: unlockPrice,
    },
  });

  if (error) throw new Error(error.message || 'Failed to send media message.');

  // Edge function wraps response in { message: {...} } with camelCase keys
  const msg = data?.message ?? data;
  if (!msg?.id) throw new Error('Message service did not return a valid message.');

  return {
    id: msg.id,
    conversation_id: msg.chatId ?? msg.chat_id ?? msg.conversation_id ?? conversationId,
    sender_id: msg.sender_id ?? msg.senderId,
    body: msg.body ?? msg.text ?? text ?? '',
    message_type: 'media',
    media_url: msg.media_url ?? msg.mediaUrl ?? mediaUrl,
    preview_url: msg.preview_url ?? msg.previewUrl ?? previewUrl,
    locked: msg.locked ?? true,
    unlocked: msg.unlocked ?? false,
    unlock_booking_id: msg.unlock_booking_id ?? msg.unlockBookingId ?? unlockBookingId ?? null,
    unlock_price: msg.unlock_price ?? msg.unlockPrice ?? unlockPrice ?? null,
    timestamp: msg.created_at ?? msg.timestamp ?? new Date().toISOString(),
  };
};

// ── Unlock a message ───────────────────────────────────────────
export const unlockMessage = async ({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}): Promise<boolean> => {
  const { data, error } = await supabase.functions.invoke('chat-messages', {
    body: {
      action: 'unlock',
      conversation_id: conversationId,
      message_id: messageId,
    },
  });

  if (error) throw new Error(error.message || 'Failed to unlock message.');
  
  return data?.success === true;
};
