import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ChatScreen from '../src/screens/ChatScreen';
import { uploadBlurredPreview, uploadImage } from '../src/services/uploadService';

const mockMessaging = {
  messages: {}, typingUsers: {}, reactions: {}, fetchMessages: jest.fn(), markMessagesRead: jest.fn(),
  subscribeToMessages: jest.fn(), broadcastTyping: jest.fn(), sendMessage: jest.fn(), sendMediaMessage: jest.fn(),
  sendLockedMediaMessage: jest.fn(), unlockPremiumMessage: jest.fn(), addReaction: jest.fn(), removeReaction: jest.fn(), deleteMessage: jest.fn(),
};
jest.mock('../src/store/MessagingContext', () => ({ useMessaging: () => mockMessaging }));
jest.mock('../src/store/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'alice' } }) }));
jest.mock('../src/store/BookingContext', () => ({ useBooking: () => ({ bookings: [] }) }));
jest.mock('../src/store/ThemeContext', () => ({ useTheme: () => ({ isDark: false, colors: { bg: '#fff', card: '#fff', text: '#111', accent: '#090', border: '#ccc', textSecondary: '#555', textMuted: '#777' } }) }));
jest.mock('../src/config/environment', () => ({ environment: { backendProvider: 'api' }, BUCKETS: { previews: 'chat-media' } }));
jest.mock('../src/services/uploadService', () => ({ uploadImage: jest.fn(), uploadBlurredPreview: jest.fn() }));
jest.mock('../src/services/chatMessageService', () => ({ getConversationAttachmentUrl: jest.fn() }));
jest.mock('../src/services/reportService', () => ({ reportContent: jest.fn() }));
jest.mock('../src/components/HowItWorksCard', () => () => null);
jest.mock('../src/components/Skeleton', () => ({ ChatSkeleton: () => null }));
jest.mock('../src/components/AnimatedBubble', () => ({ AnimatedBubble: require('react-native').View }));
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: { conversationId: 'chat-a', title: 'Chat' } }), useNavigation: () => ({ setOptions: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }), SafeAreaView: require('react-native').View }));
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => React.createElement(Text, { testID: `icon-${name}` }, name) };
});
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
jest.mock('expo-blur', () => ({ BlurView: require('react-native').View }));
jest.mock('expo-image-picker', () => ({ requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///photo.jpg', fileSize: 1024 }] }) }));
jest.mock('expo-haptics', () => ({ ImpactFeedbackStyle: { Light: 'light' }, NotificationFeedbackType: { Success: 'success' },
  impactAsync: jest.fn().mockResolvedValue(undefined), notificationAsync: jest.fn().mockResolvedValue(undefined), selectionAsync: jest.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockMessaging.messages = {};
  mockMessaging.reactions = {};
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockMessaging.fetchMessages.mockResolvedValue(undefined);
  mockMessaging.markMessagesRead.mockResolvedValue(undefined);
  mockMessaging.subscribeToMessages.mockReturnValue(() => {});
  mockMessaging.sendMediaMessage.mockResolvedValue({ id: 'media-a' });
  mockMessaging.sendMessage.mockResolvedValue({ id: 'message-a' });
  (uploadImage as jest.Mock).mockResolvedValue('chat-media::users/alice/photo.jpg');
});

afterEach(() => {
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('API attachment retry reuses its upload, durable preview, and unlocked helper', async () => {
  mockMessaging.sendMediaMessage.mockRejectedValueOnce(new Error('response lost'));
  const screen = render(<ChatScreen />);
  await waitFor(() => expect(mockMessaging.markMessagesRead).toHaveBeenCalledWith('chat-a'));
  fireEvent.press(screen.getByTestId('icon-camera'));
  await screen.findByText('Review Attachment');
  expect(screen.queryByText('Locked (Pay to see)')).toBeNull();
  expect(screen.queryByText('Price (ZAR): R')).toBeNull();
  fireEvent.press(screen.getByText('Send Now'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Upload failed', 'response lost'));
  await screen.findByText('Send Now');
  fireEvent.press(screen.getByText('Send Now'));
  await waitFor(() => expect(mockMessaging.sendMediaMessage).toHaveBeenCalledTimes(2));
  expect(uploadImage).toHaveBeenCalledTimes(1);
  expect(uploadImage).toHaveBeenCalledWith('file:///photo.jpg', 'chat-media', { returnStorageRef: true });
  expect(uploadBlurredPreview).not.toHaveBeenCalled();
  expect(mockMessaging.sendLockedMediaMessage).not.toHaveBeenCalled();
  expect(mockMessaging.sendMediaMessage.mock.calls[0]).toEqual(mockMessaging.sendMediaMessage.mock.calls[1]);
  expect(mockMessaging.sendMediaMessage.mock.calls[1][1]).toEqual({
    mediaUrl: 'chat-media::users/alice/photo.jpg', previewUrl: 'chat-media::users/alice/photo.jpg', text: 'Shared Photo',
  });
  await waitFor(() => expect(screen.queryByText('Review Attachment')).toBeNull());
});

test('failed text send leaves the draft available for retry', async () => {
  mockMessaging.sendMessage.mockRejectedValueOnce(new Error('offline'));
  const screen = render(<ChatScreen />);
  await waitFor(() => expect(mockMessaging.fetchMessages).toHaveBeenCalled());
  fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Hello');
  fireEvent.press(screen.getByTestId('icon-arrow-up'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Message blocked', 'offline'));
  expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('Hello');
  fireEvent.press(screen.getByTestId('icon-arrow-up'));
  await waitFor(() => expect(mockMessaging.sendMessage).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByPlaceholderText('Type a message...').props.value).toBe(''));
});

test('provides send/reaction/delete automation labels without unsupported messaging promises', async () => {
  mockMessaging.messages = { 'chat-a': [{ id: 'message-a', from_user: true, body: 'Hello', timestamp: '2026-10-03T10:00:00Z' }] };
  const screen = render(<ChatScreen />);
  await waitFor(() => expect(mockMessaging.markMessagesRead).toHaveBeenCalled());
  expect(screen.getByLabelText('Send message')).toBeTruthy();
  expect(screen.getByLabelText('Attach photo')).toBeTruthy();
  expect(screen.queryByText(/one intro message|SLA tracking|How Safe Messaging Works/)).toBeNull();
  fireEvent(screen.getByText('Hello'), 'longPress');
  expect(screen.getByLabelText('Delete message')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('React with \u{1F525}'));
  await waitFor(() => expect(mockMessaging.addReaction).toHaveBeenCalledWith('chat-a', 'message-a', '\u{1F525}'));
  fireEvent(screen.getByText('Hello'), 'longPress');
  fireEvent.press(screen.getByLabelText('Delete message'));
  await waitFor(() => expect(mockMessaging.deleteMessage).toHaveBeenCalledWith('chat-a', 'message-a'));
});

test('constrains incoming and outgoing long-text bubbles to the message row', async () => {
  const body = '0123456789abcdef'.repeat(40);
  mockMessaging.messages = { 'chat-a': [
    { id: 'incoming-long', from_user: false, body: `Incoming ${body}`, timestamp: '2026-10-03T10:00:00Z' },
    { id: 'outgoing-long', from_user: true, body: `Outgoing ${body}`, timestamp: '2026-10-03T10:01:00Z' },
  ] };
  const screen = render(<ChatScreen />);
  await waitFor(() => expect(mockMessaging.markMessagesRead).toHaveBeenCalled());
  for (const prefix of ['Incoming', 'Outgoing']) {
    const text = screen.getByText(`${prefix} ${body}`);
    expect(StyleSheet.flatten(text.props.style)).toMatchObject({ minWidth: 0, maxWidth: '100%' });
    const ancestorStyles = [];
    for (let node = text.parent; node; node = node.parent) {
      ancestorStyles.push(StyleSheet.flatten(node.props.style));
    }
    expect(ancestorStyles).toEqual(expect.arrayContaining([
      expect.objectContaining({ minWidth: 80, maxWidth: '100%' }),
      expect.objectContaining({ flexShrink: 1, minWidth: 0, maxWidth: '100%' }),
      expect.objectContaining({ width: '100%' }),
    ]));
  }
});
