// ============================================================
// FILE: src/services/chatMessageService.ts
// COMPLETE REPLACEMENT
// Fixes: wrong column names, aligns with live DB schema
// DB schema: messages has columns:
//   id, conversation_id, chat_id, sender_id, text, body, content,
//   message_type, media_url, created_at, booking_id
// ============================================================

import { invokeBackendFunction } from '../config/backendFunctions';
import { uid } from '../utils/id';

// Retain this ID with the draft and reuse it for every attempt of the same send.
export const createClientMessageId = (): string => uid('msg');

export class MessageSendError extends Error {
  constructor(message: string, readonly clientMessageId: string) {
    super(message);
    this.name = 'MessageSendError';
  }
}

const invokeMessageSend = async (
  payload: Record<string, unknown>,
  clientMessageId: string,
  fallback: string
) => {
  try {
    const { data, error } = await invokeBackendFunction('chat-messages', payload);
    if (error) throw new Error(error.message || fallback);
    const message = data?.message ?? data;
    if (!message?.id) throw new Error('Message service did not return a valid message.');
    return message;
  } catch (error) {
    throw new MessageSendError(error instanceof Error ? error.message : fallback, clientMessageId);
  }
};

export type MessageRow = {
  id: string;
  client_message_id?: string | null;
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
  const { data, error } = await invokeBackendFunction('chat-messages', {
    action: 'list',
    conversation_id: conversationId,
  });

  if (error) throw new Error(error.message || 'Failed to list messages.');

  // Edge function returns { messages: [...] } with camelCase keys
  const messages = data?.messages ?? [];

  return messages.map((msg: any) => ({
    id: msg.id,
    client_message_id: msg.clientMessageId ?? msg.client_message_id ?? null,
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
  clientMessageId = createClientMessageId(),
}: {
  conversationId: string;
  text: string;
  clientMessageId?: string;
}): Promise<MessageRow> => {
  // BUG FIX: Use the Edge Function which handles auth + DB insert correctly
  const msg = await invokeMessageSend({
    action: 'send',
    conversation_id: conversationId,
    client_message_id: clientMessageId,
    text,
    message_type: 'text',
  }, clientMessageId, 'Failed to send message.');

  return {
    id: msg.id,
    client_message_id: msg.clientMessageId ?? msg.client_message_id ?? clientMessageId,
    conversation_id: msg.chatId ?? msg.chat_id ?? msg.conversation_id ?? conversationId,
    sender_id: msg.sender_id ?? msg.senderId,
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

export const sendConversationMediaMessage = async ({
  conversationId,
  mediaUrl,
  previewUrl,
  text = '',
  clientMessageId = createClientMessageId(),
}: {
  conversationId: string;
  mediaUrl: string;
  previewUrl?: string;
  text?: string;
  clientMessageId?: string;
}): Promise<MessageRow> => {
  // Only durable references cross the write boundary, never signed URLs.
  for (const reference of [mediaUrl, previewUrl]) {
    if (reference !== undefined && !reference.startsWith('chat-media::')) {
      throw new MessageSendError('Use a chat-media storage reference for attachments.', clientMessageId);
    }
  }
  const msg = await invokeMessageSend({
    action: 'send',
    conversation_id: conversationId,
    client_message_id: clientMessageId,
    text,
    message_type: 'media',
    media_url: mediaUrl,
    preview_url: previewUrl,
  }, clientMessageId, 'Failed to send media message.');
  return {
    id: msg.id,
    client_message_id: msg.clientMessageId ?? msg.client_message_id ?? clientMessageId,
    conversation_id: msg.chatId ?? msg.chat_id ?? msg.conversation_id ?? conversationId,
    sender_id: msg.sender_id ?? msg.senderId,
    body: msg.body ?? msg.text ?? text,
    message_type: 'media',
    media_url: msg.media_url ?? msg.mediaUrl ?? mediaUrl,
    preview_url: msg.preview_url ?? msg.previewUrl ?? previewUrl ?? null,
    locked: msg.locked ?? false,
    unlocked: msg.unlocked ?? true,
    unlock_booking_id: msg.unlock_booking_id ?? msg.unlockBookingId ?? null,
    unlock_price: msg.unlock_price ?? msg.unlockPrice ?? null,
    timestamp: msg.created_at ?? msg.timestamp ?? new Date().toISOString(),
  };
};

export const getConversationAttachmentUrl = async ({
  conversationId,
  messageId,
  field = 'media_url',
}: {
  conversationId: string;
  messageId: string;
  field?: 'media_url' | 'preview_url';
}): Promise<string> => {
  const { data, error } = await invokeBackendFunction('chat-messages', {
    action: 'media-url',
    conversation_id: conversationId,
    message_id: messageId,
    field,
  });
  if (error) throw new Error(error.message || 'Unable to load attachment.');
  if (typeof data?.url !== 'string' || !data.url.startsWith('https://')) {
    throw new Error('Message service did not return a valid attachment URL.');
  }
  return data.url;
};

// ── Send a locked media message ────────────────────────────────
export const sendConversationLockedMediaMessage = async ({
  conversationId,
  mediaUrl,
  previewUrl,
  text,
  unlockBookingId,
  unlockPrice,
  clientMessageId = createClientMessageId(),
}: {
  conversationId: string;
  mediaUrl: string;
  previewUrl?: string;
  text?: string;
  unlockBookingId?: string;
  unlockPrice?: number;
  clientMessageId?: string;
}): Promise<MessageRow> => {
  const msg = await invokeMessageSend({
    action: 'send',
    conversation_id: conversationId,
    client_message_id: clientMessageId,
    text: text ?? 'Shared a locked photo',
    message_type: 'media',
    media_url: mediaUrl,
    preview_url: previewUrl,
    locked: true,
    unlock_booking_id: unlockBookingId,
    unlock_price: unlockPrice,
  }, clientMessageId, 'Failed to send media message.');

  return {
    id: msg.id,
    client_message_id: msg.clientMessageId ?? msg.client_message_id ?? clientMessageId,
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
  const { data, error } = await invokeBackendFunction('chat-messages', {
    action: 'unlock',
    conversation_id: conversationId,
    message_id: messageId,
  });

  if (error) throw new Error(error.message || 'Failed to unlock message.');
  
  return data?.success === true;
};
