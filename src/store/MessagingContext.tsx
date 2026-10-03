import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { backendDb, hasBackendProvider } from '../services/backendGateway';
import { ConversationSummary, Message } from '../types';
import { logError } from '../utils/errors';
import { startConversationViaEdge } from '../services/chatService';
import { createClientMessageId, getConversationAttachmentUrl, MessageRow, MessageSendError, sendConversationLockedMediaMessage, sendConversationMediaMessage, sendConversationTextMessage } from '../services/chatMessageService';
import { invokeBackendFunction } from '../config/backendFunctions';
import { trackEvent } from '../services/analyticsService';
import { useAuth } from './AuthContext';
import { Analytics } from '../utils/analytics';
import { BUCKETS, environment } from '../config/environment';
import { resolveStorageRef } from '../services/uploadService';

export type Reaction = { emoji: string; count: number; myReaction: boolean };
export type ReactionsMap = Record<string, Reaction[]>; // keyed by messageId

type MediaMessagePayload = { mediaUrl: string; previewUrl?: string; text?: string; clientMessageId?: string };

type MessagingContextValue = {
  conversations: ConversationSummary[];
  messages: Record<string, Message[]>;
  reactions: ReactionsMap;
  typingUsers: Record<string, string[]>; // chatId -> [userName, ...]
  loading: boolean;
  fetchConversations: () => Promise<void>;
  fetchMessages: (chatId: string) => Promise<void>;
  sendMessage: (chatId: string, text: string, replyToId?: string) => Promise<Message>;
  sendMediaMessage: (chatId: string, payload: MediaMessagePayload) => Promise<Message>;
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

const TIMEOUT_ERROR_MESSAGE = 'Request timed out.';
const withTimeout = async <T,>(promiseLike: PromiseLike<T>, timeoutMs = 12000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      Promise.resolve(promiseLike),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(TIMEOUT_ERROR_MESSAGE)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
const isTimeoutError = (err: unknown) =>
  err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: unknown }).message ?? '').includes(TIMEOUT_ERROR_MESSAGE)
    : false;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const chatCommand = async (chatId: string, action: string, payload: Record<string, unknown> = {}) => {
  const { data, error } = await invokeBackendFunction('chat-messages', { ...payload, action, conversation_id: chatId });
  if (error) throw new Error(error.message || 'Unable to update this conversation.');
  return data;
};

const hydrateMessage = async (raw: any, chatId: string, userId: string): Promise<Message> => {
  const attachment = async (field: 'media_url' | 'preview_url') => {
    if (!raw[field]) return null;
    try {
      if (environment.backendProvider === 'api') {
        return await getConversationAttachmentUrl({ conversationId: chatId, messageId: raw.id, field });
      }
      return await resolveStorageRef(raw[field], BUCKETS.previews);
    } catch {
      return null;
    }
  };
  const [mediaUrl, previewUrl] = await Promise.all([attachment('media_url'), attachment('preview_url')]);
  return {
    id: raw.id, conversation_id: raw.conversation_id ?? raw.chat_id ?? chatId,
    from_user: raw.sender_id === userId, body: raw.body ?? raw.text ?? '',
    timestamp: raw.created_at ?? raw.timestamp, message_type: raw.message_type ?? 'text',
    media_url: mediaUrl, preview_url: previewUrl, locked: raw.locked ?? false, unlocked: raw.unlocked ?? true,
    unlock_booking_id: raw.unlock_booking_id ?? null, unlock_price: raw.unlock_price ?? null,
    read_at: raw.read_at ?? null, reply_to_id: raw.reply_to_id ?? null, reply_preview: raw.reply_preview ?? null,
    audio_url: raw.audio_url ?? null, audio_duration_seconds: raw.audio_duration_seconds ?? null,
  };
};

const upsertMessage = (list: Message[], message: Message, optimisticId?: string) =>
  [...list.filter(row => row.id !== message.id && row.id !== optimisticId), message]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

export const MessagingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [reactions, setReactions] = useState<ReactionsMap>({});
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const draftIds = useRef(new Map<string, string>());
  const sendsInFlight = useRef(new Map<string, Promise<Message>>());
  const activeUserId = useRef(currentUser?.id);
  activeUserId.current = currentUser?.id;

  useEffect(() => {
    draftIds.current.clear();
    sendsInFlight.current.clear();
    setMessages({});
    setConversations([]);
    setReactions({});
    setTypingUsers({});
    return () => {
      Object.values(typingTimers.current).forEach(clearTimeout);
    };
  }, [currentUser?.id]);

  const fetchConversations = useCallback(async (attempt = 0) => {
    if (!hasBackendProvider || !currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Step 1: get conversation IDs this user participates in
    const { data: participations, error: partError } = await withTimeout(
      backendDb
        .from('conversation_participants')
        .select('conversation_id, user_id, last_read_at')
        .eq('user_id', currentUser.id)
    );

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
        const { data: allParticipants } = await withTimeout(
          backendDb
            .from('conversation_participants')
            .select('conversation_id, user_id, last_read_at')
            .in('conversation_id', ids)
        );

        const profileIds = [...new Set((allParticipants ?? []).map((row: any) => row.user_id).filter(Boolean))];
        let profilesMap: Record<string, any> = {};
        if (profileIds.length > 0) {
          const { data: profilesData } = await withTimeout(
            backendDb
              .from('profiles')
              .select('id, full_name, avatar_url, updated_at')
              .in('id', profileIds)
          );
          (profilesData ?? []).forEach((p: any) => { profilesMap[p.id] = p; });
        }

        for (const row of allParticipants ?? []) {
          if (!participantsByConvo[row.conversation_id]) participantsByConvo[row.conversation_id] = [];
          participantsByConvo[row.conversation_id].push(row.user_id);
          if (row.user_id === currentUser.id) continue;
          const profile = profilesMap[row.user_id];
          if (!profile) continue;
          const avatarRaw = profile.avatar_url ?? '';
          const avatar = avatarRaw ? await resolveStorageRef(avatarRaw, BUCKETS.avatars) : avatarRaw;
          participantMap[row.conversation_id] = {
            id: profile.id,
            name: profile.full_name ?? 'User',
            avatar_url: avatar,
            last_active_at: profile.updated_at ?? row.last_read_at ?? null,
          };
        }
      } catch {
        // Non-fatal — fallback to title-only
      }

      // Step 2: fetch conversation details
      const { data, error } = await withTimeout(
        backendDb
          .from('conversations')
          .select('id, title, last_message, last_message_at, created_at')
          .in('id', ids)
          .order('last_message_at', { ascending: false, nullsFirst: false })
      );

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
      if (activeUserId.current === currentUser.id) setConversations(deduped);
    } catch (err) {
      if (isTimeoutError(err) && attempt < 1) {
        await sleep(600);
        return fetchConversations(attempt + 1);
      }
      logError('Messaging:fetchConversations', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  const markMessagesRead = useCallback(async (chatId: string) => {
    if (!currentUser || !hasBackendProvider) return;
    let readAt = new Date().toISOString();
    if (environment.backendProvider === 'api') {
      const result = await chatCommand(chatId, 'read');
      if (!result?.success) throw new Error('Unable to mark messages as read.');
      readAt = result.read_at ?? readAt;
    } else {
      const { error } = await backendDb
        .from('messages')
        .update({ read_at: readAt })
        .eq('chat_id', chatId)
        .neq('sender_id', currentUser.id)
        .is('read_at', null);
      if (error) throw error;
    }
    if (activeUserId.current !== currentUser.id) return;
    setMessages(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).map(message =>
      !message.from_user && !message.read_at ? { ...message, read_at: readAt } : message) }));
  }, [currentUser]);

  const broadcastTyping = useCallback((chatId: string) => {
    if (!currentUser || !hasBackendProvider) return;
    backendDb.channel(`typing-${chatId}`).track({
      user_id: currentUser.id,
      name: currentUser.full_name ?? 'Someone',
      typing: true,
    });
    // Auto-clear after 3s
    if (typingTimers.current[chatId]) clearTimeout(typingTimers.current[chatId]);
    typingTimers.current[chatId] = setTimeout(() => {
      backendDb.channel(`typing-${chatId}`).track({ user_id: currentUser.id, typing: false });
    }, 3000);
  }, [currentUser]);

  const fetchReactions = useCallback(async (messageIds: string[]) => {
    if (!currentUser || !hasBackendProvider || messageIds.length === 0) return;
    try {
      const { data, error } = await backendDb
        .from('message_reactions')
        .select('message_id, emoji, user_id')
        .in('message_id', messageIds);
      if (error) throw error;
      if (!data || activeUserId.current !== currentUser.id) return;
      const grouped: ReactionsMap = {};
      messageIds.forEach(id => { grouped[id] = []; });
      const seen = new Set<string>();
      data.forEach((row: any) => {
        const key = JSON.stringify([row.message_id, row.user_id, row.emoji]);
        if (seen.has(key)) return;
        seen.add(key);
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

  const addReaction = useCallback(async (chatId: string, messageId: string, emoji: string) => {
    if (!currentUser || !hasBackendProvider) return;
    if (environment.backendProvider === 'api') {
      const result = await chatCommand(chatId, 'react', { message_id: messageId, operation: 'add', emoji });
      if (!result?.success) throw new Error('Unable to add reaction.');
    } else {
      const { error } = await backendDb.from('message_reactions').insert({ message_id: messageId, user_id: currentUser.id, emoji });
      if (error) throw error;
    }
    await fetchReactions([messageId]);
  }, [currentUser, fetchReactions]);

  const removeReaction = useCallback(async (chatId: string, messageId: string, emoji: string) => {
    if (!currentUser || !hasBackendProvider) return;
    if (environment.backendProvider === 'api') {
      const result = await chatCommand(chatId, 'react', { message_id: messageId, operation: 'remove', emoji });
      if (!result?.success) throw new Error('Unable to remove reaction.');
    } else {
      const { error } = await backendDb.from('message_reactions').delete()
        .eq('message_id', messageId).eq('user_id', currentUser.id).eq('emoji', emoji);
      if (error) throw error;
    }
    await fetchReactions([messageId]);
  }, [currentUser, fetchReactions]);

  const deleteMessage = useCallback(async (chatId: string, messageId: string) => {
    if (!currentUser || !hasBackendProvider) return;
    if (environment.backendProvider === 'api') {
      const result = await chatCommand(chatId, 'delete', { message_id: messageId });
      if (!result?.success) throw new Error('Unable to delete message.');
    } else {
      const { error } = await backendDb.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId).eq('sender_id', currentUser.id);
      if (error) throw error;
    }
    if (activeUserId.current !== currentUser.id) return;
    setMessages(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).filter(m => m.id !== messageId) }));
    setReactions(prev => { const next = { ...prev }; delete next[messageId]; return next; });
    await fetchConversations();
  }, [currentUser, fetchConversations]);

  const fetchMessages = useCallback(async (chatId: string) => {
    if (!hasBackendProvider || !currentUser || !chatId) return;
    try {
      let rows: any[];
      if (environment.backendProvider === 'api') {
        const result = await withTimeout(chatCommand(chatId, 'list'));
        rows = result?.messages ?? [];
      } else {
        const { data, error } = await withTimeout<{ data: any[] | null; error: any }>(
        backendDb
          .from('messages')
          .select('id, chat_id, sender_id, body, message_type, media_url, preview_url, locked, unlocked, unlock_booking_id, unlock_price, created_at, read_at, reply_to_id, reply_preview, audio_url, audio_duration_seconds')
          .eq('chat_id', chatId)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
        );
        if (error) throw error;
        rows = data ?? [];
      }
      const mapped = await Promise.all(rows.map(row => hydrateMessage(row, chatId, currentUser.id)));
      if (activeUserId.current !== currentUser.id) return;
      setMessages(prev => ({ ...prev, [chatId]: mapped }));
      // Fetch reactions for these messages
      const ids = mapped.map((m: any) => m.id);
      if (ids.length > 0) fetchReactions(ids);
    } catch (err) {
      logError('Messaging:fetchMessages', err);
      throw err;
    }
  }, [currentUser, fetchReactions]);

  const subscribeToMessages = useCallback((chatId: string) => {
    if (!hasBackendProvider || !currentUser) return () => {};

    const channel = backendDb
      .channel(`messages-${chatId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${chatId}`,
      }, async payload => {
        const raw = payload.new as any;
        if (raw.sender_id === currentUser.id) return;
        const msg = await hydrateMessage(raw, chatId, currentUser.id);
        if (activeUserId.current !== currentUser.id) return;

        setMessages(prev => {
          const list = prev[chatId] ?? [];
          if (list.some(m => m.id === msg.id)) return prev;
          return { ...prev, [chatId]: [...list, msg] };
        });

        // Auto-mark read when screen is open
        void markMessagesRead(chatId).catch(error => logError('Messaging:markRead', error));
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

    return () => { backendDb.removeChannel(channel); };
  }, [currentUser, markMessagesRead]);

  const sendDraft = (
    chatId: string, draftKey: string, body: string, media: boolean,
    send: (clientMessageId: string) => Promise<MessageRow>, providedId?: string
  ): Promise<Message> => {
    if (!currentUser || !hasBackendProvider) return Promise.reject(new Error('Auth required'));
    const inFlight = sendsInFlight.current.get(draftKey);
    if (inFlight) return inFlight;
    const clientMessageId = providedId ?? draftIds.current.get(draftKey) ?? createClientMessageId();
    draftIds.current.set(draftKey, clientMessageId);
    const optimisticId = `opt-${clientMessageId}`;
    if (!media) {
      const optimistic: Message = { id: optimisticId, conversation_id: chatId, from_user: true,
        body, timestamp: new Date().toISOString(), message_type: 'text' };
      setMessages(prev => ({ ...prev, [chatId]: upsertMessage(prev[chatId] ?? [], optimistic) }));
    }
    const request = (async () => {
      try {
        const raw = await send(clientMessageId);
        const confirmed = await hydrateMessage(raw, chatId, currentUser.id);
        if (activeUserId.current === currentUser.id) {
          draftIds.current.delete(draftKey);
          setMessages(prev => ({ ...prev, [chatId]: upsertMessage(prev[chatId] ?? [], confirmed, optimisticId) }));
          setConversations(prev => prev.map(conversation => conversation.id === chatId &&
            (!conversation.last_message_at || new Date(conversation.last_message_at) <= new Date(confirmed.timestamp))
            ? { ...conversation, last_message: confirmed.body || 'Attachment', last_message_at: confirmed.timestamp } : conversation));
        }
        void Promise.resolve().then(() => Analytics.messageSent(chatId, media)).catch(error => logError('Messaging:analytics', error));
        void Promise.resolve().then(() => trackEvent('message_sent', { conversation_id: chatId, type: media ? 'media' : 'text' })).catch(error => logError('Messaging:analytics', error));
        return confirmed;
      } catch (err) {
        const error = err instanceof MessageSendError ? err :
          new MessageSendError(err instanceof Error ? err.message : 'Unable to send message.', clientMessageId);
        if (activeUserId.current === currentUser.id) {
          draftIds.current.set(draftKey, error.clientMessageId);
          setMessages(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).filter(message => message.id !== optimisticId) }));
        }
        logError('Messaging:sendMessage', error);
        throw error;
      }
    })().finally(() => {
      if (sendsInFlight.current.get(draftKey) === request) sendsInFlight.current.delete(draftKey);
    });
    sendsInFlight.current.set(draftKey, request);
    return request;
  };

  const sendMessage = (chatId: string, text: string, replyToId?: string): Promise<Message> => {
    const trimmed = text.trim();
    if (!trimmed) return Promise.reject(new Error('Message required'));
    const draftKey = JSON.stringify([currentUser?.id, chatId, 'text', trimmed, replyToId ?? null]);
    return sendDraft(chatId, draftKey, trimmed, false, clientMessageId =>
      sendConversationTextMessage({ conversationId: chatId, text: trimmed, clientMessageId }));
  };

  const sendMediaMessage = (chatId: string, payload: MediaMessagePayload): Promise<Message> => {
    const body = payload.text?.trim() ?? '';
    const draftKey = JSON.stringify([currentUser?.id, chatId, 'media', payload.mediaUrl, payload.previewUrl ?? null, body]);
    return sendDraft(chatId, draftKey, body, true, clientMessageId =>
      sendConversationMediaMessage({ ...payload, conversationId: chatId, text: body, clientMessageId }), payload.clientMessageId);
  };

  const sendLockedMediaMessage = async (chatId: string, payload: {
    mediaUrl: string; previewUrl?: string; text?: string; unlockBookingId?: string; unlockPrice?: number;
  }): Promise<Message> => {
    if (!currentUser || !hasBackendProvider) throw new Error('Auth required');
    if (environment.backendProvider === 'api') throw new Error('Paid message locking is not enabled.');

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
    if (!currentUser || !hasBackendProvider) throw new Error('Auth required');
    if (environment.backendProvider === 'api') throw new Error('Paid message unlocking is not enabled.');
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
    if (existing && environment.backendProvider !== 'api') return { id: existing.id, title: existing.title ?? 'Conversation' };

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
      sendMessage, sendMediaMessage, sendLockedMediaMessage, unlockPremiumMessage,
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
