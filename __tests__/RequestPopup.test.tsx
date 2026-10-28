import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RequestPopup } from '../src/components/RequestPopup';
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../src/store/ThemeContext', () => ({ useTheme: () => ({ colors: {
  card: '#fff', border: '#ccc', text: '#111', textSecondary: '#555', accent: '#f0c987',
} }) }));
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
const props = () => ({ visible: true, requestData: {
  id: 'booking', payout_amount: 700, package_type: 'Portrait', is_instant: false,
}, onAccept: jest.fn(), onDecline: jest.fn(), onDismiss: jest.fn() });

test('scheduled requests are not declined or dismissed by a local timeout', () => {
  const callbacks = props();
  const screen = render(<RequestPopup {...callbacks} />);
  act(() => jest.advanceTimersByTime(30000));
  expect(callbacks.onDecline).not.toHaveBeenCalled();
  expect(callbacks.onDismiss).not.toHaveBeenCalled();
  expect(screen.queryByText(/2.4 km/)).toBeNull();
  fireEvent.press(screen.getByText('Later'));
  expect(callbacks.onDismiss).toHaveBeenCalledTimes(1);
  expect(callbacks.onDecline).not.toHaveBeenCalled();
});

test('instant offer timeout hides the popup without changing the server booking', () => {
  const callbacks = props();
  callbacks.requestData.is_instant = true;
  render(<RequestPopup {...callbacks} />);
  act(() => jest.advanceTimersByTime(15000));
  expect(callbacks.onDismiss).toHaveBeenCalledTimes(1);
  expect(callbacks.onDecline).not.toHaveBeenCalled();
});

test('in-flight actions disable all commands and cancel automatic dismissal', () => {
  const callbacks = props();
  callbacks.requestData.is_instant = true;
  const screen = render(<RequestPopup {...callbacks} busy />);
  fireEvent.press(screen.getByRole('button', { name: 'Accept booking request' }));
  fireEvent.press(screen.getByRole('button', { name: 'Decline booking request' }));
  fireEvent.press(screen.getByText('Later'));
  act(() => jest.advanceTimersByTime(30000));
  expect(callbacks.onAccept).not.toHaveBeenCalled();
  expect(callbacks.onDecline).not.toHaveBeenCalled();
  expect(callbacks.onDismiss).not.toHaveBeenCalled();
});
