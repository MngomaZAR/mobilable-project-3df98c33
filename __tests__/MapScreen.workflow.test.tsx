import React from 'react';
import { Animated, Keyboard } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import MapScreen from '../src/screens/MapScreen';
import { useAppData } from '../src/store/AppDataContext';
import { backendDb } from '../src/services/backendGateway';

const mockNavigate = jest.fn();
let mockDispatch = false;
jest.mock('../src/store/AppDataContext', () => ({ useAppData: jest.fn() }));
jest.mock('../src/store/ThemeContext', () => ({ useTheme: () => ({ colors: { bg: '#fff', text: '#000' }, isDark: false }) }));
jest.mock('../src/hooks/useServiceAccess', () => ({ useServiceAccess: () => ({ allowed: () => mockDispatch }) }));
jest.mock('../src/hooks/useRoadRoute', () => ({ useRoadRoute: () => ({ coordinates: [], durationSec: null, distanceKm: null, status: 'unavailable', retry: jest.fn() }) }));
jest.mock('../src/services/backendGateway', () => ({ backendDb: { from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() } }));
jest.mock('../src/services/dispatchService', () => ({ getHeatmap: jest.fn() }));
jest.mock('../src/utils/analytics', () => ({ Analytics: { mapOpened: jest.fn() } }));
jest.mock('../src/components/MapLibreWrapper', () => ({ isMapLibreNativeAvailable: false, MapLibreGL: {} }));
jest.mock('../src/components/MapPreview', () => ({ MapPreview: () => null }));
jest.mock('../src/components/MapAvatarPin', () => ({ MapAvatarPin: () => null }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('expo-location', () => ({ hasServicesEnabledAsync: async () => true, requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: -26.2041, longitude: 28.0473, accuracy: 10 }, timestamp: 1 }), Accuracy: { Highest: 1 } }));

let context: any;
const mockProfileScope = jest.fn();
let keyboardListeners: Record<string, (event?: any) => void>;
beforeEach(() => {
  jest.clearAllMocks(); mockDispatch = false;
  keyboardListeners = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event: string, listener: any) => {
    keyboardListeners[event] = listener;
    return { remove: jest.fn() } as any;
  });
  mockProfileScope.mockResolvedValue({ data: [{ id: 'photographer', availability_status: 'online' }], error: null });
  jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as any);
  const channel = { on: jest.fn(), subscribe: jest.fn() };
  channel.on.mockReturnValue(channel); channel.subscribe.mockReturnValue(channel);
  (backendDb.channel as jest.Mock).mockReturnValue(channel);
  (backendDb.from as jest.Mock).mockReturnValue({
    select: () => ({
      in: mockProfileScope,
    }),
  });
  context = { state: { currentUser: { id: 'client', role: 'client' }, bookings: [], models: [],
    profiles: [
      { id: 'photographer', role: 'photographer', kyc_status: 'approved', age_verified: true },
      { id: 'model', role: 'model', kyc_status: 'approved', age_verified: true },
    ],
    photographers: [{ id: 'photographer', name: 'Photo Creator', latitude: -26.196, longitude: 28.05 }] } };
  (useAppData as jest.Mock).mockReturnValue(context);
});
afterEach(() => jest.restoreAllMocks());

test('map booking opens server-priced scheduling without GPS, presence or a database mutation', async () => {
  const screen = render(<MapScreen />);
  await act(async () => {});
  expect(mockProfileScope).toHaveBeenCalledWith('id', ['photographer', 'client']);
  fireEvent.press(screen.getByRole('button', { name: 'Book Photo Creator' }));
  expect(mockNavigate).toHaveBeenCalledWith('BookingForm', { photographerId: 'photographer', serviceType: 'photography', timeMode: 'schedule' });
  expect(backendDb.from).not.toHaveBeenCalledWith('bookings');
});

test('model booking uses model ID and service type, never the photographer field', async () => {
  context.state.photographers = [];
  context.state.models = [{ id: 'model', name: 'Model Creator', latitude: -26.196, longitude: 28.05 }];
  const screen = render(<MapScreen />);
  await act(async () => {});
  fireEvent.press(screen.getByRole('button', { name: 'Book Model Creator' }));
  expect(mockNavigate).toHaveBeenCalledWith('BookingForm', { modelId: 'model', serviceType: 'modeling', timeMode: 'schedule' });
});

test('instant entry is account-gated even for an online creator', async () => {
  const screen = render(<MapScreen />);
  fireEvent.press(screen.getByText('Photo Creator'));
  await waitFor(() => expect(screen.getByText('LIVE')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Book Photo Creator now' })).toBeNull();
  mockDispatch = true; screen.rerender(<MapScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Book Photo Creator now' }));
  expect(mockNavigate).toHaveBeenCalledWith('BookingForm', { photographerId: 'photographer', serviceType: 'photography', timeMode: 'now' });
  expect(backendDb.from).not.toHaveBeenCalledWith('bookings');
});

test('failed routing exposes retry without a fabricated ETA or road distance', async () => {
  const screen = render(<MapScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));
  await waitFor(() => expect(screen.getByText(/online on map/)).toBeTruthy());
  fireEvent.press(screen.getByText('Photo Creator'));
  expect(screen.getByText('Road route and ETA unavailable.')).toBeTruthy();
  expect(screen.getByText('Direct distance')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry road route' })).toBeTruthy();
  expect(screen.queryByText(/\d+ min/)).toBeNull();
});

test('active booking opens the canonical detail/chat workflow without invented chat IDs or arrival claims', async () => {
  context.state.bookings = [{ id: 'booking', client_id: 'client', photographer_id: 'photographer', status: 'accepted', payment_status: 'unpaid' }];
  const screen = render(<MapScreen />);
  await act(async () => {});
  expect(screen.getByText('Booking accepted')).toBeTruthy();
  expect(screen.queryByText(/En Route|ETA|15 min/)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Open booking details and chat' }));
  expect(mockNavigate).toHaveBeenCalledWith('BookingDetail', { bookingId: 'booking' });
});

test('pending schedules are not labeled instant and paid-out shoots are not active', async () => {
  context.state.bookings = [{ id: 'booking', client_id: 'client', photographer_id: 'photographer', status: 'pending', is_instant: false }];
  const screen = render(<MapScreen />);
  await act(async () => {});
  expect(screen.getByText('Scheduled')).toBeTruthy();
  context.state.bookings[0].status = 'paid_out'; screen.rerender(<MapScreen />);
  expect(screen.queryByRole('button', { name: 'View active booking' })).toBeNull();
});

test('the native sheet stays within the measured map viewport instead of covering it', async () => {
  const screen = render(<MapScreen />);
  await act(async () => {});
  fireEvent(screen.getByTestId('native-talent-map'), 'layout', { nativeEvent: { layout: { height: 620, width: 390 } } });
  expect(screen.getByTestId('talent-map-sheet')).toHaveStyle({ height: 483.6, bottom: 0 });
  fireEvent(screen.getByTestId('native-talent-map'), 'layout', { nativeEvent: { layout: { height: 310, width: 844 } } });
  expect(screen.getByTestId('talent-map-sheet')).toHaveStyle({ height: 241.8, bottom: 0 });
});

test('the map sheet and map controls move above the keyboard', async () => {
  const screen = render(<MapScreen />);
  await act(async () => {});
  fireEvent(screen.getByTestId('native-talent-map'), 'layout', { nativeEvent: { layout: { height: 620, width: 390 } } });
  const onShow = keyboardListeners.keyboardDidShow ?? keyboardListeners.keyboardWillShow;
  act(() => onShow({ endCoordinates: { height: 260 } }));
  expect(screen.getByTestId('talent-map-sheet')).toHaveStyle({ height: 280.8, bottom: 260 });
  const onHide = keyboardListeners.keyboardDidHide ?? keyboardListeners.keyboardWillHide;
  act(() => onHide());
  expect(screen.getByTestId('talent-map-sheet')).toHaveStyle({ height: 483.6, bottom: 0 });
});

test('the map panel handle is an accessible tap target for expanding and collapsing', async () => {
  const screen = render(<MapScreen />);
  await act(async () => {});
  fireEvent.press(screen.getByRole('button', { name: 'Expand talent panel' }));
  expect(screen.getByRole('button', { name: 'Collapse talent panel' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Collapse talent panel' }));
  expect(screen.getByRole('button', { name: 'Expand talent panel' })).toBeTruthy();
});

test('unapproved and synthetic talent cannot appear on the map', async () => {
  context.state.profiles[0].is_test_account = true;
  const screen = render(<MapScreen />);
  await act(async () => {});
  expect(screen.queryByText('Photo Creator')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Book Photo Creator' })).toBeNull();
  context.state.profiles[0].is_test_account = false;
  context.state.profiles[0].kyc_status = 'pending';
  screen.rerender(<MapScreen />);
  expect(screen.queryByText('Photo Creator')).toBeNull();
});
