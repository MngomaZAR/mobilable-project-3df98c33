import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import SupportScreen from '../src/screens/SupportScreen';
import { submitSupportTicket } from '../src/services/supportService';

jest.mock('../src/services/supportService', () => ({ submitSupportTicket: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: { bookingId: 'booking-reference', category: 'billing', subject: 'Booking issue' } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

afterEach(() => jest.restoreAllMocks());

test('a real submitted ticket contains the booking and returns its persisted reference', async () => {
  (submitSupportTicket as jest.Mock).mockResolvedValue({ id: 'persisted-ticket-id' });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<SupportScreen />);
  fireEvent.changeText(screen.getByLabelText('Support description'), 'Please investigate this booking payment');
  fireEvent.press(screen.getByText('Submit ticket'));
  await waitFor(() => expect(submitSupportTicket).toHaveBeenCalledWith({ subject: 'Booking issue', category: 'billing', description: 'Booking reference: booking-reference\n\nPlease investigate this booking payment' }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Ticket submitted', 'Reference: persisted-ticket-id', expect.any(Array)));
});

test('an interrupted submission keeps the draft and does not claim success', async () => {
  (submitSupportTicket as jest.Mock).mockRejectedValue(new Error('Connection interrupted'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<SupportScreen />);
  fireEvent.changeText(screen.getByLabelText('Support description'), 'Keep this draft');
  fireEvent.press(screen.getByText('Submit ticket'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Error', 'Connection interrupted'));
  expect(screen.getByLabelText('Support description').props.value).toBe('Keep this draft');
});
