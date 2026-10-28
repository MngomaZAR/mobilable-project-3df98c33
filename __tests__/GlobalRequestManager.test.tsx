import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { GlobalRequestManager } from '../src/components/GlobalRequestManager';

const mockNavigate = jest.fn();
const mockUpdate = jest.fn();
let mockUser: any;
let mockBookings: any[];
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24 }) }));
jest.mock('../src/store/AppDataContext', () => ({ useAppData: () => ({
  state: { currentUser: mockUser, bookings: mockBookings }, updateBookingStatus: mockUpdate,
}) }));
jest.mock('../src/components/RequestPopup', () => ({ RequestPopup: (props: any) => {
  const { View, Button, Text } = require('react-native');
  return <View><Text>{props.requestData.id}</Text>
    <Button title="Accept" disabled={props.busy} onPress={props.onAccept} />
    <Button title="Decline" disabled={props.busy} onPress={props.onDecline} />
    <Button title="Later" disabled={props.busy} onPress={props.onDismiss} />
  </View>;
} }));
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'creator', role: 'photographer' };
  mockBookings = [{ id: 'booking', photographer_id: 'creator', status: 'pending' }];
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('acceptance uses the shared booking command and navigates only after confirmation', async () => {
  let resolve!: (value: any) => void;
  mockUpdate.mockImplementation(() => new Promise(done => { resolve = done; }));
  const screen = render(<GlobalRequestManager />);
  fireEvent.press(screen.getByText('Accept'));
  fireEvent.press(screen.getByText('Accept'));
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockUpdate).toHaveBeenCalledWith('booking', 'accepted');
  expect(mockNavigate).not.toHaveBeenCalled();
  resolve({ id: 'booking', status: 'accepted' });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('BookingDetail', { bookingId: 'booking' }));
});

test('failed decline stays visible and can be retried', async () => {
  mockUpdate.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({ id: 'booking', status: 'declined' });
  const screen = render(<GlobalRequestManager />);
  await act(async () => { fireEvent.press(screen.getByText('Decline')); });
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Unable to update request', 'Connection lost'));
  expect(screen.getByText('booking')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Decline')); });
  await waitFor(() => expect(screen.queryByText('booking')).toBeNull());
  expect(mockUpdate).toHaveBeenLastCalledWith('booking', 'declined');
});

test('Later dismisses only the popup without mutating the booking', () => {
  const screen = render(<GlobalRequestManager />);
  fireEvent.press(screen.getByText('Later'));
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(screen.queryByText('booking')).toBeNull();
});

test('models receive their own pending bookings, not another creator requests', () => {
  mockUser = { id: 'model', role: 'model' };
  mockBookings.push({ id: 'model-booking', model_id: 'model', status: 'pending' });
  const screen = render(<GlobalRequestManager />);
  expect(screen.getByText('model-booking')).toBeTruthy();
  expect(screen.queryByText('booking')).toBeNull();
});

test('clients and terminal bookings never receive request popups', () => {
  mockUser = { id: 'creator', role: 'client' };
  const screen = render(<GlobalRequestManager />);
  expect(screen.queryByText('booking')).toBeNull();
  mockUser = { id: 'creator', role: 'photographer' };
  mockBookings[0].status = 'cancelled';
  screen.rerender(<GlobalRequestManager />);
  expect(screen.queryByText('booking')).toBeNull();
});
