import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import PaymentScreen from '../src/screens/PaymentScreen';
import { fetchBookingById } from '../src/services/bookingService';
import { createPayfastCheckoutLink } from '../src/services/paymentService';

let mockBooking: any;
let mockAllowed = true;
const mockRefresh = jest.fn();
const mockNavigate = jest.fn();
jest.mock('../src/store/AppDataContext', () => ({ useAppData: () => ({
  state: { currentUser: { id: 'client' }, bookings: [mockBooking] }, fetchBookings: mockRefresh,
}) }));
jest.mock('../src/hooks/useServiceAccess', () => ({ useServiceAccess: () => ({ allowed: () => mockAllowed }) }));
jest.mock('../src/services/paymentService', () => ({ createPayfastCheckoutLink: jest.fn() }));
jest.mock('../src/services/bookingService', () => ({ fetchBookingById: jest.fn() }));
jest.mock('../src/config/commercePolicy', () => ({ getDefaultPayfastNotifyUrl: () => 'https://api.unit.invalid/payments/payfast/itn' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }), useRoute: () => ({ params: { bookingId: 'booking' } }),
}));
jest.mock('../src/components/PaymentWebView', () => ({ PaymentWebView: ({ onSuccess }: any) => {
  const { Button } = require('react-native');
  return <Button title="Gateway returned" onPress={onSuccess} />;
} }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAllowed = true;
  mockBooking = { id: 'booking', client_id: 'client', status: 'accepted', payment_status: 'unpaid', total_amount: 50, package_type: 'Test shoot' };
  (fetchBookingById as jest.Mock).mockImplementation(async () => mockBooking);
  (createPayfastCheckoutLink as jest.Mock).mockResolvedValue({ paymentUrl: 'https://www.payfast.co.za/test' });
  mockRefresh.mockResolvedValue(undefined);
});

test('checkout waits for creator acceptance and remains gated by server access', () => {
  mockBooking.status = 'pending';
  const view = render(<PaymentScreen />);
  expect(view.getByRole('button', { name: 'Awaiting creator acceptance' })).toBeDisabled();
  mockBooking.status = 'accepted'; mockAllowed = false;
  view.rerender(<PaymentScreen />);
  expect(view.getByRole('button', { name: 'Pay for shoot' })).toBeDisabled();
  expect(createPayfastCheckoutLink).not.toHaveBeenCalled();
});

test('gateway redirect alone never confirms payment or starts post-payment dispatch', async () => {
  const view = render(<PaymentScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Pay for shoot' }));
  fireEvent.press(view.getByRole('button', { name: 'Opening checkout...' }));
  await waitFor(() => expect(view.getByText('Gateway returned')).toBeTruthy());
  expect(createPayfastCheckoutLink).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByText('Gateway returned'));
  await waitFor(() => expect(fetchBookingById).toHaveBeenCalledWith('booking'));
  expect(view.queryByText('Payment confirmed.')).toBeNull();
  expect(mockRefresh).not.toHaveBeenCalled();
  view.unmount();
});

test('payment polling times out once despite booking-cache refreshes', async () => {
  jest.useFakeTimers();
  try {
    const view = render(<PaymentScreen />);
    await act(async () => fireEvent.press(view.getByRole('button', { name: 'Check payment status' })));
    for (let index = 0; index < 15; index++) {
      mockBooking = { ...mockBooking };
      view.rerender(<PaymentScreen />);
      await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
    }
    expect(view.getByText(/Payment is not yet confirmed/)).toBeTruthy();
    const reads = (fetchBookingById as jest.Mock).mock.calls.length;
    await act(async () => { await jest.advanceTimersByTimeAsync(10000); });
    expect(fetchBookingById).toHaveBeenCalledTimes(reads);
    view.unmount();
  } finally { jest.useRealTimers(); }
});

test('server confirmation ends polling and never allows paying a refunded booking', async () => {
  (fetchBookingById as jest.Mock).mockResolvedValue({ ...mockBooking, payment_status: 'paid' });
  const view = render(<PaymentScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Check payment status' }));
  await waitFor(() => expect(view.getByText('Payment confirmed.')).toBeTruthy());
  expect(mockRefresh).toHaveBeenCalledWith('client');
  mockBooking.payment_status = 'refunded';
  view.rerender(<PaymentScreen />);
  expect(view.getByRole('button', { name: 'Awaiting creator acceptance' })).toBeDisabled();
});

test('failed checkout retains booking and permits an explicit retry', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    (createPayfastCheckoutLink as jest.Mock).mockRejectedValueOnce(new Error('Network unavailable'));
    const view = render(<PaymentScreen />);
    fireEvent.press(view.getByRole('button', { name: 'Pay for shoot' }));
    await waitFor(() => expect(view.getByText('Network unavailable')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Pay for shoot' }));
    await waitFor(() => expect(createPayfastCheckoutLink).toHaveBeenCalledTimes(2));
  } finally { alert.mockRestore(); }
});
