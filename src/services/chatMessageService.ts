import { supabase } from '../config/supabaseClient';

export type ChatMessagePayload = {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  timestamp: string;
  messageType: 'text' | 'media';
  mediaUrl?: string | null;
  previewUrl?: string | null;
  locked?: boolean;
  unlocked?: boolean;
  unlockBookingId?: string | null;
};

export const listConversationMessages = async (conversationId: string): Promise<ChatMessagePayload[]> => {
  const { data, error } = await supabase.functions.invoke('chat-messages', {
    body: {
      action: 'list',
      conversation_id: conversationId,
    },
  });

  if (error) {
    throw new Error(error.message || 'Unable to load conversation messages.');
  }

  const rows = Array.isArray(data?.messages) ? data.messages : [];
  return rows as ChatMessagePayload[];
};

type SendTextInput = {
  conversationId: string;
  text: string;
};

export const sendConversationTextMessage = async ({
  conversationId,
  text,
}: SendTextInput): Promise<ChatMessagePayload> => {
  const { data, error } = await supabase.functions.invoke('chat-messages', {
    body: {
      action: 'send',
      conversation_id: conversationId,
      message_type: 'text',
      text,
    },
  });

  if (error) {
    throw new Error(error.message || 'Unable to send message.');
  }

  if (!data?.message?.id) {
    throw new Error('Chat service did not return a message.');
  }

  return data.message as ChatMessagePayload;
};

type SendLockedMediaInput = {
  conversationId: string;
  mediaUrl: string;
  previewUrl?: string;
  text?: string;
  unlockBookingId: string;
};

export const sendConversationLockedMediaMessage = async ({
  conversationId,
  mediaUrl,
  previewUrl,
  text,
  unlockBookingId,
}: SendLockedMediaInput): Promise<ChatMessagePayload> => {
  const { data, error } = await supabase.functions.invoke('chat-messages', {
    body: {
      action: 'send',
      conversation_id: conversationId,
      message_type: 'media',
      media_url: mediaUrl,
      preview_url: previewUrl,
      text: text ?? '',
      locked: true,
      unlock_booking_id: unlockBookingId,
    },
  });

  if (error) {
    throw new Error(error.message || 'Unable to send media.');
  }

  if (!data?.message?.id) {
    throw new Error('Chat service did not return a media message.');
  }

  return data.message as ChatMessagePayload;
};

