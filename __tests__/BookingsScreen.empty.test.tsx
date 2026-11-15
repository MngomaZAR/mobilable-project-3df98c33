import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import BookingsScreen from '../src/screens/BookingsScreen';

const mockNavigate = jest.fn();
const mockFetchBookings = jest.fn(async () => {});
let mockCurrentUser: { id: string } | null = null;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../src/store/AppDataContext', () => ({ useAppData: () => ({
  state: { currentUser: mockCurrentUser, bookings: [], photographers: [], models: [] },
  fetchBookings: mockFetchBookings,
}) }));
jest.mock('../src/store/ThemeContext', () => ({ useTheme: () => ({
  isDark: false,
  colors: { bg: '#fff', text: '#111', textMuted: '#666', accent: '#f0c987', border: '#ddd' },
}) }));

test('empty bookings leads the client back to creator discovery', () => {
  const screen = render(<BookingsScreen />);
  expect(screen.getByText('No bookings yet.')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Explore creators' }));
  expect(mockNavigate).toHaveBeenCalledWith('Root', { screen: 'Home' });
});

test('focused API bookings reload for the signed-in user', async () => {
  mockCurrentUser = { id: 'client-1' };
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  render(<BookingsScreen />);
  await waitFor(() => expect(mockFetchBookings).toHaveBeenCalledWith('client-1'));
  mockCurrentUser = null;
});
