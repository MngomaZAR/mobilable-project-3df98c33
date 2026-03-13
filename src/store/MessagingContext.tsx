import React, { createContext, useCallback, useContext, useState } from 'react';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { ConversationSummary, Message, AppUser } from '../types';
import { logError } from '../utils/errors';
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
  subscribeToMessages: (chatId: string) => () => void;
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
      // Step 1: get conversation IDs this user participates in
      const { data: participations, error: partError } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id, last_read_at, profiles:user_id(id, full_name, avatar_url, updated_at)')
        .eq('user_id', currentUser.id);

      if (partError) throw partError;
      if (!participations || participations.length === 0) {
        setConversations([]);
        return;
      }

      const ids = participations.map((p: any) => p.conversation_id);

      // Build a participant map with richer context
      const participantMap: Record<string, { id: string; name: string; avatar_url: string; last_active_at?: string | null }> = {};
      const participantsByConvo: Record<string, string[]> = {};
      try {
        const { data: allParticipants } = await supabase
          .from('conversation_participants')
          .select('conversation_id, user_id, last_read_at, profiles:user_id(id, full_name, avatar_url, updated_at)')
          .in('conversation_id', ids);

        (allParticipants ?? []).forEach((row: any) => {
          if (!participantsByConvo[row.conversation_id]) participantsByConvo[row.conversation_id] = [];
          participantsByConvo[row.conversation_id].push(row.user_id);
          if (row.user_id === currentUser.id) return;
          const profile = row.profiles;
          if (!profile) return;
          participantMap[row.conversation_id] = {
            id: profile.id,
            name: profile.full_name ?? 'User',
            avatar_url: profile.avatar_url ?? '',
            last_active_at: profile.updated_at ?? row.last_read_at ?? null,
          };
        });
      } catch {
        // Non-fatal — fallback to title-only
      }

      // Step 2: fetch conversation details
      const { data, error } = await supabase
        .from('conversations')
        .select('id, title, last_message, last_message_at, created_at')
        .in('id', ids)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (error) throw error;

      const mapped: ConversationSummary[] = (data ?? []).map((c: any) => ({
        id: c.id,
        title: c.title ?? participantMap[c.id]?.name ?? 'Conversation',
        last_message: c.last_message ?? '',
        last_message_at: c.last_message_at ?? c.created_at,
        created_at: c.created_at,
        participants: participantsByConvo[c.id] ?? [],
        participant: participantMap[c.id],
      }));

      setConversations(mapped);
    } catch (err) {
      logError('Messaging:fetchConversations', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  const fetchMessages = useCallback(async (chatId: string) => {
    if (!hasSupabase || !chatId) return;
    try {
      // Direct DB query using the correct column name: chat_id
      const { data, error } = await supabase
        .from('messages')
        .select('id, chat_id, sender_id, body, message_type, media_url, preview_url, locked, unlocked, unlock_booking_id, created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      setMessages(prev => ({
        ...prev,
        [chatId]: (data ?? []).map((m: any) => ({
          id: m.id,
          conversation_id: m.chat_id,
          from_user: m.sender_id === currentUser?.id,
          body: m.body ?? '',
          timestamp: m.created_at,
          message_type: m.message_type ?? 'text',
          media_url: m.media_url ?? null,
          preview_url: m.preview_url ?? null,
          locked: m.locked ?? false,
          unlocked: m.unlocked ?? true,
          unlock_booking_id: m.unlock_booking_id ?? null,
        })),
      }));
    } catch (err) {
      logError('Messaging:fetchMessages', err);
    }
  }, [currentUser]);

  const subscribeToMessages = useCallback((chatId: string) => {
    if (!hasSupabase || !currentUser) return () => {};

    const channel = supabase
      .channel(`messages-${chatId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${chatId}`,
      }, payload => {
        const raw = payload.new as any;
        if (raw.sender_id === currentUser.id) return; // already optimistically added

        const msg: Message = {
          id: raw.id,
          conversation_id: raw.chat_id,
          from_user: false,
          body: raw.body ?? '',
          timestamp: raw.created_at ?? new Date().toISOString(),
          message_type: raw.message_type ?? 'text',
          media_url: raw.media_url ?? null,
          preview_url: raw.preview_url ?? null,
          locked: raw.locked ?? false,
          unlocked: raw.unlocked ?? true,
          unlock_booking_id: raw.unlock_booking_id ?? null,
        };

        setMessages(prev => {
          const list = prev[chatId] ?? [];
          if (list.some(m => m.id === msg.id)) return prev;
          return { ...prev, [chatId]: [...list, msg] };
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser]);

  const sendMessage = async (chatId: string, text: string): Promise<Message> => {
    if (!currentUser || !hasSupabase) throw new Error('Auth required');
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Message required');

    // Optimistic local insert
    const optimisticId = `opt-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId,
      conversation_id: chatId,
      from_user: true,
      body: trimmed,
      timestamp: new Date().toISOString(),
      message_type: 'text',
    };
    setMessages(prev => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), optimistic] }));

    try {
      // Insert directly to DB (chat_id is the real column)
      const { data, error } = await supabase
        .from('messages')
        .insert({ chat_id: chatId, sender_id: currentUser.id, body: trimmed, message_type: 'text' })
        .select('id, chat_id, sender_id, body, message_type, created_at')
        .single();

      if (error) throw error;

      const confirmed: Message = {
        id: data.id,
        conversation_id: data.chat_id,
        from_user: true,
        body: data.body ?? trimmed,
        timestamp: data.created_at,
        message_type: 'text',
      };

      // Replace optimistic with confirmed
      setMessages(prev => ({
        ...prev,
        [chatId]: (prev[chatId] ?? []).map(m => m.id === optimisticId ? confirmed : m),
      }));

      // Update conversation preview
      await supabase
        .from('conversations')
        .update({ last_message: trimmed, last_message_at: data.created_at })
        .eq('id', chatId);

      trackEvent('message_sent', { conversation_id: chatId });
      return confirmed;
    } catch (err) {
      // Remove optimistic message on error
      setMessages(prev => ({
        ...prev,
        [chatId]: (prev[chatId] ?? []).filter(m => m.id !== optimisticId),
      }));
      logError('Messaging:sendMessage', err);
      throw err;
    }
  };

  const sendLockedMediaMessage = async (chatId: string, payload: {
    mediaUrl: string; previewUrl?: string; text?: string; unlockBookingId: string;
  }): Promise<Message> => {
    if (!currentUser || !hasSupabase) throw new Error('Auth required');

    const { data, error } = await supabase
      .from('messages')
      .insert({
        chat_id: chatId,
        sender_id: currentUser.id,
        body: payload.text ?? 'Shared a locked photo',
        message_type: 'media',
        media_url: payload.mediaUrl,
        preview_url: payload.previewUrl ?? null,
        locked: true,
        unlocked: false,
        unlock_booking_id: payload.unlockBookingId,
      })
      .select('id, chat_id, sender_id, body, message_type, media_url, preview_url, locked, unlocked, unlock_booking_id, created_at')
      .single();

    if (error) throw error;

    const confirmed: Message = {
      id: data.id,
      conversation_id: data.chat_id,
      from_user: true,
      body: data.body ?? '',
      timestamp: data.created_at,
      message_type: 'media',
      media_url: data.media_url,
      preview_url: data.preview_url,
      locked: data.locked,
      unlocked: data.unlocked,
      unlock_booking_id: data.unlock_booking_id,
    };

    setMessages(prev => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), confirmed] }));
    trackEvent('message_sent', { conversation_id: chatId, type: 'media_locked' });
    return confirmed;
  };

  const startConversationWithUser = async (participantId: string, title?: string) => {
    if (!currentUser) throw new Error('Auth required');

    // Check for existing conversation
    const existing = conversations.find(c =>
      c.participants && c.participants.includes(participantId)
    );
    if (existing) return { id: existing.id, title: existing.title ?? 'Conversation' };

    try {
      const result = await startConversationViaEdge({ participantId, title });
      trackEvent('session_start', { participant_id: participantId, mode: 'chat' });
      await fetchConversations();
      return result;
    } catch (err) {
      logError('Messaging:startConversation', err);
      throw err;
    }
  };

  return (
    <MessagingContext.Provider value={{
      conversations, messages, loading,
      fetchConversations, fetchMessages,
      sendMessage, sendLockedMediaMessage,
      startConversationWithUser, subscribeToMessages,
    }}>
      {children}
    </MessagingContext.Provider>
  );
};

export const useMessaging = () => {
  const ctx = useContext(MessagingContext);
  if (!ctx) throw new Error('useMessaging must be used within MessagingProvider');
  return ctx;
};
