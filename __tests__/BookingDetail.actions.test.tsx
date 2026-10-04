import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import BookingDetailScreen from '../src/screens/BookingDetailScreen';
import { useAppData } from '../src/store/AppDataContext';
import { fetchBookingById } from '../src/services/bookingService';

const mockNavigate = jest.fn();
const mockChat = jest.fn();
const mockUpdate = jest.fn();
jest.mock('../src/store/AppDataContext', () => ({ useAppData: jest.fn() }));
jest.mock('../src/hooks/useServiceAccess', () => ({ useServiceAccess: () => ({ allowed: () => true }) }));
jest.mock('../src/services/bookingService', () => ({ fetchBookingById: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { bookingId: 'booking-1' } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

const booking = { id: 'booking-1', client_id: 'client', photographer_id: 'photographer', model_id: null, booking_date: '2026-10-20', package_type: 'Portrait shoot', status: 'accepted', payment_status: 'unpaid', total_amount: 1200 };
let context: any;
beforeEach(() => {
  jest.clearAllMocks();
  context = { state: { currentUser: { id: 'client' }, bookings: [{ ...booking }], photographers: [{ id: 'photographer', name: 'Creator' }], models: [], profiles: [] }, startConversationWithUser: mockChat, updateBookingStatus: mockUpdate };
  (useAppData as jest.Mock).mockReturnValue(context);
  mockChat.mockResolvedValue({ id: 'conversation', title: 'Booking chat' });
});

test('provider opens a real client conversation instead of chatting with themselves', async () => {
  context.state.currentUser.id = 'photographer';
  const screen = render(<BookingDetailScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Open chat' }));
  await waitFor(() => expect(mockChat).toHaveBeenCalledWith('client', 'Client'));
  expect(mockNavigate).toHaveBeenCalledWith('ChatThread', { conversationId: 'conversation', title: 'Booking chat' });
});

test('a booking outside the cached list is fetched with working detail actions', async () => {
  context.state.bookings = [];
  (fetchBookingById as jest.Mock).mockResolvedValue({ ...booking });
  const screen = render(<BookingDetailScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open chat' })).toBeTruthy());
  expect(fetchBookingById).toHaveBeenCalledWith('booking-1');
});

test('an interrupted detail fetch can retry without claiming the booking is missing', async () => {
  context.state.bookings = [];
  (fetchBookingById as jest.Mock).mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce({ ...booking });
  const screen = render(<BookingDetailScreen />);
  await waitFor(() => expect(screen.getByText('Connection interrupted')).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Retry booking' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open chat' })).toBeTruthy());
});

test('support opens the actual ticket form with booking context', () => {
  const screen = render(<BookingDetailScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Booking support' }));
  expect(mockNavigate).toHaveBeenCalledWith('Support', { bookingId: 'booking-1', category: 'billing', subject: 'Booking issue' });
});

test('a failed conversation shows an error rather than a silent inbox fallback', async () => {
  mockChat.mockRejectedValue(new Error('Connection interrupted'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const screen = render(<BookingDetailScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Open chat' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Chat unavailable', 'Connection interrupted'));
    expect(mockNavigate).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

test('unconfirmed cancellation never displays a success or a refund promise', async () => {
  mockUpdate.mockResolvedValue(undefined);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const screen = render(<BookingDetailScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Cancel booking' }));
    const buttons = alert.mock.calls[0][2]!;
    await act(async () => { await (buttons[1].onPress as () => Promise<void>)(); });
    expect(alert).toHaveBeenLastCalledWith('Cancellation failed', 'Cancellation was not confirmed. Please refresh and retry.');
  } finally { alert.mockRestore(); }
});

test('model review navigation references the exact completed paid booking', () => {
  context.state.bookings[0] = { ...booking, photographer_id: '', model_id: 'model', status: 'completed', payment_status: 'paid' };
  const screen = render(<BookingDetailScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Leave a review' }));
  expect(mockNavigate).toHaveBeenCalledWith('Reviews', { photographerId: 'model', bookingId: 'booking-1' });
});

test('missing dates render safely and unpaid bookings cannot open tracking', () => {
  context.state.bookings[0].booking_date = '';
  const screen = render(<BookingDetailScreen />);
  expect(screen.getByText('Date unavailable')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Track on map' })).toBeDisabled();
});
