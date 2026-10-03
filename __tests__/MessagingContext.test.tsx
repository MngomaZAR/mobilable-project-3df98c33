import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { MessagingProvider, useMessaging } from '../src/store/MessagingContext';
import { backendDb } from '../src/services/backendGateway';
import { invokeBackendFunction } from '../src/config/backendFunctions';
import { createClientMessageId, getConversationAttachmentUrl, MessageSendError, sendConversationLockedMediaMessage, sendConversationMediaMessage, sendConversationTextMessage } from '../src/services/chatMessageService';

let mockUser: any = { id: 'alice', full_name: 'Alice' };
let mockNextId = 0;
jest.mock('../src/store/AuthContext', () => ({ useAuth: () => ({ currentUser: mockUser }) }));
jest.mock('../src/config/environment', () => ({ environment: { backendProvider: 'api' }, BUCKETS: { avatars: 'avatars', previews: 'chat-media' } }));
jest.mock('../src/services/backendGateway', () => ({ hasBackendProvider: true, backendDb: { from: jest.fn() } }));
jest.mock('../src/config/backendFunctions', () => ({ invokeBackendFunction: jest.fn() }));
jest.mock('../src/services/chatMessageService', () => ({
  ...jest.requireActual('../src/services/chatMessageService'),
  createClientMessageId: jest.fn(() => `draft-${++mockNextId}`),
  sendConversationTextMessage: jest.fn(), sendConversationMediaMessage: jest.fn(), sendConversationLockedMediaMessage: jest.fn(),
  getConversationAttachmentUrl: jest.fn(),
}));
jest.mock('../src/services/chatService', () => ({ startConversationViaEdge: jest.fn() }));
jest.mock('../src/services/uploadService', () => ({ resolveStorageRef: jest.fn(async value => value) }));
jest.mock('../src/services/analyticsService', () => ({ trackEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/analytics', () => ({ Analytics: { messageSent: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../src/utils/errors', () => ({ logError: jest.fn() }));

const textSend = sendConversationTextMessage as jest.Mock;
const mediaSend = sendConversationMediaMessage as jest.Mock;
const command = invokeBackendFunction as jest.Mock;
const from = backendDb.from as jest.Mock;

const message = (id = 'message-a', extra: Record<string, unknown> = {}) => ({
  id, conversation_id: 'chat-a', sender_id: 'alice', body: 'Hello', message_type: 'text',
  timestamp: '2026-10-03T10:00:00Z', ...extra,
});

const query = (data: any[]) => {
  const result: any = Promise.resolve({ data, error: null });
  for (const method of ['select', 'eq', 'neq', 'in', 'is', 'order', 'update', 'insert', 'delete']) {
    result[method] = jest.fn(() => result);
  }
  return result;
};
const wrapper = ({ children }: { children: React.ReactNode }) => <MessagingProvider>{children}</MessagingProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'alice', full_name: 'Alice' };
  mockNextId = 0;
  from.mockImplementation(() => query([]));
  command.mockResolvedValue({ data: { success: true, read_at: '2026-10-03T11:00:00Z' }, error: null });
  textSend.mockResolvedValue(message());
  mediaSend.mockResolvedValue(message('media-a', { message_type: 'media', media_url: 'chat-media::users/alice/photo.jpg' }));
  (getConversationAttachmentUrl as jest.Mock).mockResolvedValue('https://api.example.test/storage/object?expiry=fresh');
});

test('continues past the own participant and loads conversation details', async () => {
  let participations = 0;
  from.mockImplementation(table => {
    if (table === 'conversation_participants') return query(++participations === 1
      ? [{ conversation_id: 'chat-a', user_id: 'alice' }]
      : [{ conversation_id: 'chat-a', user_id: 'alice' }, { conversation_id: 'chat-a', user_id: 'bob' }]);
    if (table === 'profiles') return query([{ id: 'alice' }, { id: 'bob', full_name: 'Bob', avatar_url: '' }]);
    return query([{ id: 'chat-a', title: 'Chat', created_at: '2026-10-03T10:00:00Z' }]);
  });
  const { result } = renderHook(useMessaging, { wrapper });
  await act(async () => { await result.current.fetchConversations(); });
  expect(result.current.conversations).toHaveLength(1);
  expect(result.current.conversations[0]).toMatchObject({ participant: { id: 'bob', name: 'Bob' }, participants: ['alice', 'bob'] });
});

test('retains the failed draft ID and original MessageSendError, then clears it on success', async () => {
  let originalError: MessageSendError;
  textSend.mockImplementationOnce(({ clientMessageId }) => {
    originalError = new MessageSendError('response lost', clientMessageId);
    return Promise.reject(originalError);
  });
  const { result } = renderHook(useMessaging, { wrapper });
  let failure: unknown;
  await act(async () => { try { await result.current.sendMessage('chat-a', 'Hello'); } catch (error) { failure = error; } });
  expect(failure).toBe(originalError!);
  expect(result.current.messages['chat-a']).toEqual([]);
  const key = textSend.mock.calls[0][0].clientMessageId;
  await act(async () => { await result.current.sendMessage('chat-a', 'Hello'); });
  expect(textSend.mock.calls[1][0].clientMessageId).toBe(key);
  expect(result.current.messages['chat-a']).toHaveLength(1);
  expect(from).not.toHaveBeenCalled();
  await act(async () => { await result.current.sendMessage('chat-a', 'Hello'); });
  expect(textSend.mock.calls[2][0].clientMessageId).not.toBe(key);
});

test('coalesces concurrent sends of the same logical draft', async () => {
  let complete!: (row: any) => void;
  textSend.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  const { result } = renderHook(useMessaging, { wrapper });
  await act(async () => {
    const first = result.current.sendMessage('chat-a', 'Hello');
    const second = result.current.sendMessage('chat-a', 'Hello');
    complete(message());
    await Promise.all([first, second]);
  });
  expect(textSend).toHaveBeenCalledTimes(1);
  expect(result.current.messages['chat-a']).toHaveLength(1);
});

test('keeps edited text and different conversations as different draft identities', async () => {
  textSend.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(useMessaging, { wrapper });
  await act(async () => {
    for (const [chatId, text] of [['chat-a', 'Hello'], ['chat-a', 'Edited'], ['chat-b', 'Hello']]) {
      await result.current.sendMessage(chatId, text).catch(() => {});
    }
  });
  expect(new Set(textSend.mock.calls.map(([payload]) => payload.clientMessageId)).size).toBe(3);
});

test('retains media retry keys and signs attachments only after a successful send', async () => {
  mediaSend.mockImplementationOnce(({ clientMessageId }) => Promise.reject(new MessageSendError('offline', clientMessageId)));
  const ref = 'chat-media::users/alice/photo.jpg';
  const { result } = renderHook(useMessaging, { wrapper });
  await act(async () => { await result.current.sendMediaMessage('chat-a', { mediaUrl: ref, previewUrl: ref }).catch(() => {}); });
  expect(getConversationAttachmentUrl).not.toHaveBeenCalled();
  await act(async () => { await result.current.sendMediaMessage('chat-a', { mediaUrl: ref, previewUrl: ref }); });
  expect(mediaSend.mock.calls[1][0].clientMessageId).toBe(mediaSend.mock.calls[0][0].clientMessageId);
  expect(mediaSend.mock.calls[1][0]).toMatchObject({ mediaUrl: ref, previewUrl: ref });
  expect(result.current.messages['chat-a'][0].media_url).toMatch(/^https:\/\//);
  expect(getConversationAttachmentUrl).toHaveBeenCalledWith({ conversationId: 'chat-a', messageId: 'media-a', field: 'media_url' });
});

test('routes read/delete/reaction writes through API commands and deduplicates legacy reaction rows', async () => {
  const queries: any[] = [];
  from.mockImplementation(table => {
    const result = query(table === 'message_reactions' ? [
      { message_id: 'message-a', user_id: 'alice', emoji: 'fire' },
      { message_id: 'message-a', user_id: 'alice', emoji: 'fire' },
      { message_id: 'message-a', user_id: 'bob', emoji: 'fire' },
    ] : []);
    queries.push(result);
    return result;
  });
  const { result } = renderHook(useMessaging, { wrapper });
  await act(async () => {
    await result.current.markMessagesRead('chat-a');
    await result.current.addReaction('chat-a', 'message-a', 'fire');
    await result.current.removeReaction('chat-a', 'message-a', 'fire');
    await result.current.deleteMessage('chat-a', 'message-a');
  });
  expect(command.mock.calls.map(([, payload]) => payload.action)).toEqual(['read', 'react', 'react', 'delete']);
  expect(command.mock.calls[1][1]).toMatchObject({ conversation_id: 'chat-a', message_id: 'message-a', operation: 'add' });
  expect(command.mock.calls[2][1].operation).toBe('remove');
  for (const result of queries) {
    expect(result.update).not.toHaveBeenCalled();
    expect(result.insert).not.toHaveBeenCalled();
    expect(result.delete).not.toHaveBeenCalled();
  }
  await act(async () => { await result.current.fetchReactions(['message-a']); });
  expect(result.current.reactions['message-a']).toEqual([{ emoji: 'fire', count: 2, myReaction: true }]);
});

test('loads API messages through the command and marks only incoming messages read', async () => {
  command.mockImplementation(async (_name, payload) => ({ data: payload.action === 'list'
    ? { messages: [message(), message('incoming', { sender_id: 'bob' })] }
    : { success: true, read_at: '2026-10-03T11:00:00Z' }, error: null }));
  const { result } = renderHook(useMessaging, { wrapper });
  await act(async () => { await result.current.fetchMessages('chat-a'); await result.current.markMessagesRead('chat-a'); });
  expect(result.current.messages['chat-a'].find(row => row.id === 'incoming')?.read_at).toBe('2026-10-03T11:00:00Z');
  expect(result.current.messages['chat-a'].find(row => row.id === 'message-a')?.read_at).toBeNull();
  expect(from).not.toHaveBeenCalledWith('messages');
});

test('surfaces denied control writes and never removes a message on failed delete', async () => {
  const { result } = renderHook(useMessaging, { wrapper });
  await act(async () => { await result.current.sendMessage('chat-a', 'Hello'); });
  command.mockResolvedValue({ data: null, error: { message: 'blocked' } });
  await act(async () => {
    await expect(result.current.deleteMessage('chat-a', 'message-a')).rejects.toThrow('blocked');
    await expect(result.current.addReaction('chat-a', 'message-a', 'fire')).rejects.toThrow('blocked');
    await expect(result.current.removeReaction('chat-a', 'message-a', 'fire')).rejects.toThrow('blocked');
    await expect(result.current.markMessagesRead('chat-a')).rejects.toThrow('blocked');
  });
  expect(result.current.messages['chat-a']).toHaveLength(1);
});

test('does not call the paid helper for API media', async () => {
  const { result } = renderHook(useMessaging, { wrapper });
  await expect(result.current.sendLockedMediaMessage('chat-a', { mediaUrl: 'chat-media::users/alice/photo.jpg' })).rejects.toThrow('not enabled');
  await expect(result.current.unlockPremiumMessage('chat-a', 'message-a')).rejects.toThrow('not enabled');
  expect(sendConversationLockedMediaMessage).not.toHaveBeenCalled();
  expect(createClientMessageId).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalled();
});
