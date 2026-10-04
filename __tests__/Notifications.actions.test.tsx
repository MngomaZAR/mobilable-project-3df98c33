import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import NotificationsScreen from '../src/screens/NotificationsScreen';
import { respondToDispatch } from '../src/services/dispatchService';

const mockNavigate = jest.fn();
const mockRead = jest.fn();
const mockUpdate = jest.fn();
const mockAcknowledge = jest.fn();
let mockAllowed = true;
const mockFrom = jest.fn(() => ({
  select: () => ({ eq: () => ({ order: () => ({ limit: mockRead }) }) }),
  update: mockUpdate,
}));
jest.mock('../src/services/backendGateway', () => ({ hasBackendProvider: true, backendDb: { from: (...args: unknown[]) => mockFrom(...args) } }));
jest.mock('../src/services/dispatchService', () => ({ respondToDispatch: jest.fn() }));
jest.mock('../src/store/AppDataContext', () => ({ useAppData: () => ({ state: { currentUser: { id: 'creator-1' } } }) }));
jest.mock('../src/hooks/useServiceAccess', () => ({ useServiceAccess: () => ({ allowed: () => mockAllowed }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));

const invite = { id: 'notification-1', event_type: 'booking_call_invite', title: 'Booking call invitation', body: 'Join your booking call',
  status: 'unread', category: 'booking', action_type: 'booking', action_payload: { booking_id: 'booking-1', session_id: 'session-1' }, created_at: '2026-10-04T12:00:00Z' };
const offer = { ...invite, event_type: 'booking_dispatch_offered', title: 'Instant booking offer',
  action_payload: { booking_id: 'booking-1', dispatch_request_id: 'dispatch-1', offer_id: 'offer-1' } };
let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockAllowed = true;
  mockRead.mockResolvedValue({ data: [invite], error: null });
  mockUpdate.mockReturnValue({ eq: () => ({ eq: mockAcknowledge }) });
  mockAcknowledge.mockResolvedValue({ error: null });
  (respondToDispatch as jest.Mock).mockResolvedValue({ success: true });
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());
const loaded = async () => {
  const view = render(<NotificationsScreen />);
  await waitFor(() => expect(mockRead).toHaveBeenCalled());
  await act(async () => {});
  return view;
};

test('booking call invites open a server-booking route and persist read status, not credentials', async () => {
  const view = await loaded();
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Booking call invitation' })); });
  expect(mockNavigate).toHaveBeenCalledWith('BookingDetail', { bookingId: 'booking-1' });
  expect(mockUpdate).toHaveBeenCalledWith({ status: 'read', read_at: expect.any(String) });
  expect(view.getByText('Booking call invitation')).toBeTruthy();
});

test('message notifications use the canonical conversation identifier', async () => {
  mockRead.mockResolvedValue({ data: [{ ...invite, event_type: 'message_received', action_payload: { conversation_id: 'conversation-1' } }], error: null });
  const view = await loaded();
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Booking call invitation' })); });
  expect(mockNavigate).toHaveBeenCalledWith('ChatThread', { conversationId: 'conversation-1' });
});

test('failed notification fetch shows a retry instead of a false empty inbox', async () => {
  mockRead.mockResolvedValueOnce({ data: null, error: { message: 'Connection interrupted' } });
  const view = await loaded();
  expect(view.getByText('Connection interrupted')).toBeTruthy();
  expect(view.queryByText('No notifications yet')).toBeNull();
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Retry notifications' })); });
  expect(view.getByText('Booking call invitation')).toBeTruthy();
});

test('viewing an offer does not consume its acceptance action', async () => {
  mockRead.mockResolvedValue({ data: [offer], error: null });
  const view = await loaded();
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Instant booking offer' })); });
  expect(view.getByRole('button', { name: 'Accept instant booking offer' })).toBeEnabled();
});

test('dispatch acceptance waits for the server and immediate duplicate taps do not send two responses', async () => {
  mockRead.mockResolvedValue({ data: [offer], error: null });
  let finish!: (value: unknown) => void;
  (respondToDispatch as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = await loaded();
  act(() => {
    const button = view.getByRole('button', { name: 'Accept instant booking offer' });
    fireEvent.press(button); fireEvent.press(button);
  });
  expect(respondToDispatch).toHaveBeenCalledTimes(1);
  expect(mockUpdate).not.toHaveBeenCalled();
  await act(async () => { finish({ success: true }); });
  expect(respondToDispatch).toHaveBeenCalledWith({ dispatch_request_id: 'dispatch-1', offer_id: 'offer-1', response: 'accept', idempotency_key: 'notification-1-accept' });
  expect(mockUpdate).toHaveBeenCalledWith({ status: 'dismissed', read_at: expect.any(String) });
  expect(view.queryByRole('button', { name: 'Accept instant booking offer' })).toBeNull();
});

test('a failed dispatch response retains the action and never writes a read acknowledgement', async () => {
  mockRead.mockResolvedValue({ data: [offer], error: null });
  (respondToDispatch as jest.Mock).mockRejectedValue(new Error('Offer expired'));
  const view = await loaded();
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Accept instant booking offer' })); });
  expect(alert).toHaveBeenCalledWith('Notification action', 'Offer expired');
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: 'Accept instant booking offer' })).toBeTruthy();
});

test('unaccepted dispatch remains disabled while decline is available for cleanup', async () => {
  mockRead.mockResolvedValue({ data: [offer], error: null });
  mockAllowed = false;
  const view = await loaded();
  expect(view.getByRole('button', { name: 'Accept instant booking offer' })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Decline instant booking offer' })).toBeEnabled();
});
