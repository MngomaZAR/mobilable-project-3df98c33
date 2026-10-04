import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import BookingFormScreen from '../src/screens/BookingFormScreen';
import { useAppData } from '../src/store/AppDataContext';
import { backendDb } from '../src/services/backendGateway';
import { apiClient } from '../src/config/apiClient';

jest.mock('../src/store/AppDataContext', () => ({ useAppData: jest.fn() }));
jest.mock('../src/hooks/useServiceAccess', () => ({ useServiceAccess: () => ({ allowed: () => false }) }));
jest.mock('../src/store/MessagingContext', () => ({ useMessaging: () => ({ startConversationWithUser: jest.fn() }) }));
jest.mock('../src/config/environment', () => ({ environment: { backendProvider: 'api' } }));
jest.mock('../src/config/apiSession', () => ({ getApiAccessToken: async () => 'synthetic-unit-token' }));
jest.mock('../src/config/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/services/backendGateway', () => ({ backendDb: { from: jest.fn() } }));
jest.mock('../src/services/dispatchService', () => ({ createDispatch: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), replace: jest.fn() }),
  useRoute: () => ({ params: { photographerId: 'creator-beyond-first-page' } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn() }));
jest.mock('../src/components/BookingCalendar', () => ({ BookingCalendar: () => null }));
jest.mock('../src/components/LocationPickerModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../src/components/HowItWorksCard', () => ({ __esModule: true, default: () => null }));

const creatorId = 'creator-beyond-first-page';
const blocked = 'This provider is not verified yet. Booking is disabled until KYC approval.';
const options = {
  role: 'photographer',
  packages: [{ id: 'standard', label: 'Published package', rate_zar: 1400, pricing_basis: 'hour' }],
  services: [], equipment: { camera: [], lenses: [], lighting: [], extras: [] },
};
let profileQuery: { select: jest.Mock; eq: jest.Mock; maybeSingle: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  profileQuery = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn() };
  profileQuery.select.mockReturnValue(profileQuery);
  profileQuery.eq.mockReturnValue(profileQuery);
  (backendDb.from as jest.Mock).mockReturnValue(profileQuery);
  (apiClient.get as jest.Mock).mockResolvedValue(options);
  (useAppData as jest.Mock).mockReturnValue({
    state: {
      currentUser: { id: 'client', city: 'Durban' },
      photographers: [{ id: creatorId, name: 'Selected creator', style: '', location: 'Durban', tags: [], latitude: -29.85, longitude: 31.03 }],
      models: [], profiles: [],
    },
    createBooking: jest.fn(), refresh: jest.fn(),
  });
});

test('loads selected creator verification even when absent from the profile cache', async () => {
  profileQuery.maybeSingle.mockResolvedValue({ data: { id: creatorId, verified: true, age_verified: true, kyc_status: 'approved' }, error: null });
  const screen = render(<BookingFormScreen />);
  await waitFor(() => expect(screen.getByText('Published package')).toBeTruthy());
  expect(backendDb.from).toHaveBeenCalledWith('profiles');
  expect(profileQuery.eq).toHaveBeenCalledWith('id', creatorId);
  expect(screen.queryByText(blocked)).toBeNull();
});

test('does not trust an approved cached profile over a fresh pending result', async () => {
  const context = (useAppData as jest.Mock)();
  context.state.profiles = [{ id: creatorId, verified: true, age_verified: true, kyc_status: 'approved' }];
  profileQuery.maybeSingle.mockResolvedValue({ data: { id: creatorId, verified: false, age_verified: true, kyc_status: 'pending' }, error: null });
  const screen = render(<BookingFormScreen />);
  await waitFor(() => expect(screen.getByText('Published package')).toBeTruthy());
  expect(screen.getByText(blocked)).toBeTruthy();
});

test('verification lookup failure stays disabled without declaring the creator unverified', async () => {
  profileQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Unable to reach verification service' } });
  const screen = render(<BookingFormScreen />);
  await waitFor(() => expect(screen.getByText('Unable to reach verification service')).toBeTruthy());
  expect(screen.queryByText('Published package')).toBeNull();
  expect(screen.queryByText(blocked)).toBeNull();
});
