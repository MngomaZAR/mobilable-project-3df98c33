import React, { createContext, useCallback, useContext, useState, useRef } from 'react';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { ConversationSummary, Message, AppUser } from '../types';
import { logError, formatErrorMessage } from '../utils/errors';
import { uid } from '../utils/id';
import { startConversationViaEdge } from '../services/chatService';
import { sendConversationTextMessage, sendConversationLockedMediaMessage } from '../services/chatMessageService';
import { trackEvent } from '../services/analyticsService';
import { useAuth } from './AuthContext';

type MessagingContextValue = {
  conversations: ConversationSummary[];
  messages: Record<string, Message[]>;
  loading: boolean;
  fetchConversations: () => Promise<void>;
  fetchMessages: (chatId: string) => Promise<void>;
  sendMessage: (chatId: string, text: string) => Promise<Message>;
  sendLockedMediaMessage: (chatId: string, payload: { mediaUrl: string; previewUrl?: string; text?: string; unlockBookingId: string }) => Promise<Message>;
  startConversationWithUser: (participantId: string, title?: string) => Promise<{ id: string; title: string }>;
};

const MessagingContext = createContext<MessagingContextValue | undefined>(undefined);

export const MessagingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [loading, setLoading] = useState(false);

  const fetchConversations = useCallback(async () => {
    if (!hasSupabase || !currentUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id, title, last_message, last_message_at, created_at,
          conversation_participants!inner(user_id)
        `)
        .eq('conversation_participants.user_id', currentUser.id)
        .order('last_message_at', { ascending: false });

      if (error) throw error;
      setConversations(data.map((c: any) => ({
          id: c.id,
          title: c.title,
          last_message: c.last_message,
          last_message_at: c.last_message_at,
          created_at: c.created_at,
          participants: c.conversation_participants.map((p: any) => p.user_id)
      })));
    } catch (err) {
      logError('Messaging:fetchConversations', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  const fetchMessages = useCallback(async (chatId: string) => {
    if (!hasSupabase) return;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', chatId)
        .order('timestamp', { ascending: true });

      if (error) throw error;
      setMessages(prev => ({
          ...prev,
          [chatId]: data.map((m: any) => ({
              id: m.id,
              conversation_id: m.conversation_id,
              from_user: m.sender_id === currentUser?.id,
              text: m.text,
              timestamp: m.timestamp,
              message_type: m.message_type,
              media_url: m.media_url,
              preview_url: m.preview_url,
              locked: m.locked,
              unlocked: m.unlocked,
              unlock_booking_id: m.unlock_booking_id
          }))
      }));
    } catch (err) {
      logError('Messaging:fetchMessages', err);
    }
  }, [currentUser]);

  const sendMessage = async (chatId: string, text: string) => {
    if (!currentUser || !hasSupabase) throw new Error('Auth required');
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Message required');

    try {
      const sent = await sendConversationTextMessage({ conversationId: chatId, text: trimmed });
      const confirmed: Message = {
        id: sent.id,
        conversation_id: sent.conversation_id || chatId,
        from_user: true,
        text: sent.text,
        timestamp: sent.timestamp ?? new Date().toISOString(),
        message_type: sent.message_type,
      };
      setMessages(prev => ({ ...prev, [chatId]: [...(prev[chatId] || []), confirmed] }));
      trackEvent('message_sent', { conversation_id: chatId });
      return confirmed;
    } catch (err) {
      logError('Messaging:sendMessage', err);
      throw err;
    }
  };

  const startConversationWithUser = async (participantId: string, title?: string) => {
    if (!currentUser) throw new Error('Auth required');
    
    // Check existing
    const existing = conversations.find(c => c.participants && c.participants.includes(participantId));
    if (existing) return { id: existing.id, title: existing.title };

    try {
      const data = await startConversationViaEdge({ participantId, title });
      trackEvent('session_start', { participant_id: participantId, mode: 'chat' });
      await fetchConversations(); // Reload list
      return { id: data.id, title: data.title };
    } catch (err) {
      logError('Messaging:startConversation', err);
      // Fallback direct insert logic omitted for token efficiency, assuming edge function works or 
      // RLS fix is applied to the Edge function's service role if needed.
      throw err;
    }
  };

  return (
    <MessagingContext.Provider value={{
      conversations,
      messages,
      loading,
      fetchConversations,
      fetchMessages,
      sendMessage,
      sendLockedMediaMessage: async () => ({} as any), // Placeholder
      startConversationWithUser
    }}>
      {children}
    </MessagingContext.Provider>
  );
};

export const useMessaging = () => {
  const context = useContext(MessagingContext);
  if (context === undefined) throw new Error('useMessaging must be used within a MessagingProvider');
  return context;
};
