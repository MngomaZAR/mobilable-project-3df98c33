import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { ConversationSummary, Message, AppUser } from '../types';
import { logError } from '../utils/errors';
import { startConversationViaEdge } from '../services/chatService';
import { sendConversationLockedMediaMessage, sendConversationTextMessage } from '../services/chatMessageService';
import { trackEvent } from '../services/analyticsService';
import { useAuth } from './AuthContext';
import { Analytics } from '../utils/analytics';
import { BUCKETS } from '../config/environment';
import { parseStorageRef, resolveStorageRef } from '../services/uploadService';

export type Reaction = { emoji: string; count: number; myReaction: boolean };
export type ReactionsMap = Record<string, Reaction[]>; // keyed by messageId

type MessagingContextValue = {
  conversations: ConversationSummary[];
  messages: Record<string, Message[]>;
  reactions: ReactionsMap;
  typingUsers: Record<string, string[]>; // chatId -> [userName, ...]
  loading: boolean;
  fetchConversations: () => Promise<void>;
  fetchMessages: (chatId: string) => Promise<void>;
  sendMessage: (chatId: string, text: string, replyToId?: string) => Promise<Message>;
  sendLockedMediaMessage: (chatId: string, payload: { mediaUrl: string; previewUrl?: string; text?: string; unlockBookingId?: string; unlockPrice?: number; }) => Promise<Message>;
  unlockPremiumMessage: (chatId: string, messageId: string) => Promise<boolean>;
  startConversationWithUser: (participantId: string, title?: string) => Promise<{ id: string; title: string }>;
  subscribeToMessages: (chatId: string) => () => void;
  markMessagesRead: (chatId: string) => Promise<void>;
  broadcastTyping: (chatId: string) => void;
  addReaction: (chatId: string, messageId: string, emoji: string) => Promise<void>;
  removeReaction: (chatId: string, messageId: string, emoji: string) => Promise<void>;
  fetchReactions: (messageIds: string[]) => Promise<void>;
  deleteMessage: (chatId: string, messageId: string) => Promise<void>;
};

const MessagingContext = createContext<MessagingContextValue | undefined>(undefined);

const withTimeout = async <T,>(promiseLike: PromiseLike<T>, timeoutMs = 12000): Promise<T> => {
  return await Promise.race<T>([
    Promise.resolve(promiseLike),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Request timed out.')), timeoutMs)),
  ]);
};

export const MessagingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [reactions, setReactions] = useState<ReactionsMap>({});
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const fetchConversations = useCallback(async () => {
    if (!hasSupabase || !currentUser) return;
    setLoading(true);
    try {
      // Step 1: get conversation IDs this user participates in
      const { data: participations, error: partError } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id, last_read_at')
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
          .select('conversation_id, user_id, last_read_at')
          .in('conversation_id', ids);

        const profileIds = [...new Set((allParticipants ?? []).map((row: any) => row.user_id).filter(Boolean))];
        let profilesMap: Record<string, any> = {};
        if (profileIds.length > 0) {
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('id, full_name, avatar_url, updated_at')
            .in('id', profileIds);
          (profilesData ?? []).forEach((p: any) => { profilesMap[p.id] = p; });
        }

        (allParticipants ?? []).forEach((row: any) => {
          if (!participantsByConvo[row.conversation_id]) participantsByConvo[row.conversation_id] = [];
          participantsByConvo[row.conversation_id].push(row.user_id);
          if (row.user_id === currentUser.id) return;
          const profile = profilesMap[row.user_id];
          if (!profile) return;
          const avatarRaw = profile.avatar_url ?? '';
          const parsed = parseStorageRef(avatarRaw);
          const avatar = parsed
            ? supabase.storage.from(parsed.bucket as any).getPublicUrl(parsed.path).data.publicUrl
            : avatarRaw && !/^https?:\/\//i.test(avatarRaw)
              ? supabase.storage.from(BUCKETS.avatars as any).getPublicUrl(avatarRaw).data.publicUrl
              : avatarRaw;
          participantMap[row.conversation_id] = {
            id: profile.id,
            name: profile.full_name ?? 'User',
            avatar_url: avatar,
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

      const deduped = mapped.filter((conversation, index, list) =>
        list.findIndex((item) => item.id === conversation.id) === index
      );
      setConversations(deduped);
    } catch (err) {
      logError('Messaging:fetchConversations', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  const markMessagesRead = useCallback(async (chatId: string) => {
    if (!currentUser || !hasSupabase) return;
    try {
      await supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('chat_id', chatId)
        .neq('sender_id', currentUser.id)
        .is('read_at', null);
    } catch { /* silent */ }
  }, [currentUser]);

  const broadcastTyping = useCallback((chatId: string) => {
    if (!currentUser || !hasSupabase) return;
    supabase.channel(`typing-${chatId}`).track({
      user_id: currentUser.id,
      name: (currentUser as any).full_name ?? 'Someone',
      typing: true,
    });
    // Auto-clear after 3s
    if (typingTimers.current[chatId]) clearTimeout(typingTimers.current[chatId]);
    typingTimers.current[chatId] = setTimeout(() => {
      supabase.channel(`typing-${chatId}`).track({ user_id: currentUser.id, typing: false });
    }, 3000);
  }, [currentUser]);

  const addReaction = useCallback(async (chatId: string, messageId: string, emoji: string) => {
    if (!currentUser || !hasSupabase) return;
    try {
      await supabase.from('message_reactions').insert({ message_id: messageId, user_id: currentUser.id, emoji });
      await fetchReactions([messageId]);
    } catch { /* likely duplicate — ignore */ }
  }, [currentUser]); // eslint-disable-line

  const removeReaction = useCallback(async (chatId: string, messageId: string, emoji: string) => {
    if (!currentUser || !hasSupabase) return;
    try {
      await supabase.from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', currentUser.id)
        .eq('emoji', emoji);
      await fetchReactions([messageId]);
    } catch { /* silent */ }
  }, [currentUser]); // eslint-disable-line

  const fetchReactions = useCallback(async (messageIds: string[]) => {
    if (!currentUser || !hasSupabase || messageIds.length === 0) return;
    try {
      const { data } = await supabase
        .from('message_reactions')
        .select('message_id, emoji, user_id')
        .in('message_id', messageIds);
      if (!data) return;
      const grouped: ReactionsMap = {};
      messageIds.forEach(id => { grouped[id] = []; });
      data.forEach((row: any) => {
        const existing = grouped[row.message_id]?.find((r: Reaction) => r.emoji === row.emoji);
        if (existing) {
          existing.count++;
          if (row.user_id === currentUser.id) existing.myReaction = true;
        } else {
          if (!grouped[row.message_id]) grouped[row.message_id] = [];
          grouped[row.message_id].push({ emoji: row.emoji, count: 1, myReaction: row.user_id === currentUser.id });
        }
      });
      setReactions(prev => ({ ...prev, ...grouped }));
    } catch { /* silent */ }
  }, [currentUser]);

  const deleteMessage = useCallback(async (chatId: string, messageId: string) => {
    if (!currentUser || !hasSupabase) return;
    try {
      await supabase.from('messages').update({ deleted_at: new Date().toISOString(), body: 'Message deleted' }).eq('id', messageId).eq('sender_id', currentUser.id);
      setMessages(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).filter(m => m.id !== messageId) }));
    } catch { /* silent */ }
  }, [currentUser]);

  const fetchMessages = useCallback(async (chatId: string) => {
    if (!hasSupabase || !chatId) return;
    try {
      // Direct DB query using the correct column name: chat_id
      const { data, error } = await withTimeout<{ data: any[] | null; error: any }>(
        supabase
          .from('messages')
          .select('id, chat_id, sender_id, body, message_type, media_url, preview_url, locked, unlocked, unlock_booking_id, unlock_price, created_at, read_at, reply_to_id, reply_preview, audio_url, audio_duration_seconds')
          .eq('chat_id', chatId)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
      );

      if (error) throw error;

      const mapped = await Promise.all((data ?? []).map(async (m: any) => {
        let mediaUrl = m.media_url ?? null;
        let previewUrl = m.preview_url ?? null;
        try {
          mediaUrl = mediaUrl ? await resolveStorageRef(mediaUrl, BUCKETS.previews) : null;
          previewUrl = previewUrl ? await resolveStorageRef(previewUrl, BUCKETS.previews) : null;
        } catch {
          // Non-fatal, keep raw refs
        }
        return {
          id: m.id,
          conversation_id: m.chat_id,
          from_user: m.sender_id === currentUser?.id,
          body: m.body ?? '',
          timestamp: m.created_at,
          message_type: m.message_type ?? 'text',
          media_url: mediaUrl,
          preview_url: previewUrl,
          locked: m.locked ?? false,
          unlocked: m.unlocked ?? true,
          unlock_booking_id: m.unlock_booking_id ?? null,
          unlock_price: m.unlock_price ?? m.unlockPrice ?? null,
          read_at: m.read_at ?? null,
          reply_to_id: m.reply_to_id ?? null,
          reply_preview: m.reply_preview ?? null,
          audio_url: m.audio_url ?? null,
          audio_duration_seconds: m.audio_duration_seconds ?? null,
        };
      }));
      setMessages(prev => ({ ...prev, [chatId]: mapped }));
      // Fetch reactions for these messages
      const ids = mapped.map((m: any) => m.id);
      if (ids.length > 0) fetchReactions(ids);
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
      }, async payload => {
        const raw = payload.new as any;
        if (raw.sender_id === currentUser.id) return;
        let mediaUrl = raw.media_url ?? null;
        let previewUrl = raw.preview_url ?? null;
        try {
          mediaUrl = mediaUrl ? await resolveStorageRef(mediaUrl, BUCKETS.previews) : null;
          previewUrl = previewUrl ? await resolveStorageRef(previewUrl, BUCKETS.previews) : null;
        } catch {
          // Non-fatal, keep raw refs
        }

        const msg: Message = {
          id: raw.id,
          conversation_id: raw.chat_id,
          from_user: false,
          body: raw.body ?? '',
          timestamp: raw.created_at ?? new Date().toISOString(),
          message_type: raw.message_type ?? 'text',
          media_url: mediaUrl,
          preview_url: previewUrl,
          locked: raw.locked ?? false,
          unlocked: raw.unlocked ?? true,
          unlock_booking_id: raw.unlock_booking_id ?? null,
          unlock_price: raw.unlock_price ?? raw.unlockPrice ?? null,
          read_at: null,
          reply_to_id: raw.reply_to_id ?? null,
          reply_preview: raw.reply_preview ?? null,
        };

        setMessages(prev => {
          const list = prev[chatId] ?? [];
          if (list.some(m => m.id === msg.id)) return prev;
          return { ...prev, [chatId]: [...list, msg] };
        });

        // Auto-mark read when screen is open
        markMessagesRead(chatId);
      })
      // Typing presence
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ user_id: string; name: string; typing: boolean }>();
        const typers = Object.values(state)
          .flat()
          .filter((u: any) => u.user_id !== currentUser.id && u.typing)
          .map((u: any) => u.name);
        setTypingUsers(prev => ({ ...prev, [chatId]: typers }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser, markMessagesRead]);

  const sendMessage = async (chatId: string, text: string, replyToId?: string): Promise<Message> => {
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
      const data = await sendConversationTextMessage({
        conversationId: chatId,
        text: trimmed,
      });
      Analytics.messageSent(chatId, false);

      const confirmed: Message = {
        id: data.id,
        conversation_id: data.conversation_id,
        from_user: true,
        body: data.body ?? trimmed,
        timestamp: data.timestamp,
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
        .update({ last_message: trimmed, last_message_at: data.timestamp })
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
    mediaUrl: string; previewUrl?: string; text?: string; unlockBookingId?: string; unlockPrice?: number;
  }): Promise<Message> => {
    if (!currentUser || !hasSupabase) throw new Error('Auth required');

    const rawMessage = await sendConversationLockedMediaMessage({
      conversationId: chatId,
      ...payload
    });

    const confirmed: Message = {
      id: rawMessage.id,
      conversation_id: rawMessage.conversation_id,
      from_user: rawMessage.sender_id === currentUser.id,
      body: rawMessage.body,
      timestamp: rawMessage.timestamp,
      message_type: 'media',
      media_url: rawMessage.media_url,
      preview_url: rawMessage.preview_url,
      locked: rawMessage.locked,
      unlocked: rawMessage.unlocked,
      unlock_booking_id: rawMessage.unlock_booking_id,
      unlock_price: rawMessage.unlock_price,
    };

    setMessages(prev => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), confirmed] }));
    trackEvent('message_sent', { conversation_id: chatId, type: 'media_locked' });
    return confirmed;
  };

  const unlockPremiumMessage = async (chatId: string, messageId: string): Promise<boolean> => {
    if (!currentUser || !hasSupabase) throw new Error('Auth required');
    const { unlockMessage } = require('../services/chatMessageService');
    const success = await unlockMessage({ conversationId: chatId, messageId });
    if (success) {
      setMessages(prev => {
        const list = prev[chatId] ?? [];
        return {
          ...prev,
          [chatId]: list.map(m => m.id === messageId ? { ...m, unlocked: true } : m),
        };
      });
    }
    return success;
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
      conversations, messages, reactions, typingUsers, loading,
      fetchConversations, fetchMessages,
      sendMessage, sendLockedMediaMessage, unlockPremiumMessage,
      startConversationWithUser, subscribeToMessages,
      markMessagesRead, broadcastTyping,
      addReaction, removeReaction, fetchReactions,
      deleteMessage,
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
