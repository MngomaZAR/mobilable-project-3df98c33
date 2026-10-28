import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AccountConfigScreen from '../src/screens/AccountConfigScreen';
import { useAppData } from '../src/store/AppDataContext';
import { requestCreatorEnrolment } from '../src/services/accountService';

const mockNavigate = jest.fn();
const mockRefresh = jest.fn();
const mockUpdateProfile = jest.fn();
jest.mock('../src/store/AppDataContext', () => ({ useAppData: jest.fn() }));
jest.mock('../src/services/accountService', () => ({ requestCreatorEnrolment: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../src/store/ThemeContext', () => ({ useTheme: () => ({ isDark: false, colors: {
  bg: '#fff', text: '#111', textMuted: '#666', card: '#fff', border: '#ddd', accent: '#087f63',
} }) }));

beforeEach(() => {
  jest.clearAllMocks();
  (useAppData as jest.Mock).mockReturnValue({
    state: { models: [], photographers: [] }, currentUser: { id: 'owner', role: 'client', full_name: 'Fixture Creator', city: 'Durban' },
    updateProfile: mockUpdateProfile, refresh: mockRefresh, saving: false,
  });
  mockUpdateProfile.mockResolvedValue(undefined);
  mockRefresh.mockResolvedValue(undefined);
  (requestCreatorEnrolment as jest.Mock).mockResolvedValue({ role: 'model', kyc_status: 'pending', approved: false });
});

test('creator application requires explicit policy consent', () => {
  const screen = render(<AccountConfigScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Apply as a creator' }));
  expect(requestCreatorEnrolment).not.toHaveBeenCalled();
  expect(mockUpdateProfile).not.toHaveBeenCalled();
});

test('existing client saves profile, applies in the chosen role and enters identity review', async () => {
  const screen = render(<AccountConfigScreen />);
  fireEvent.press(screen.getByRole('radio', { name: 'Model' }));
  fireEvent.press(screen.getByRole('checkbox', { name: 'I accept the Creator Policy' }));
  fireEvent.press(screen.getByRole('button', { name: 'Apply as a creator' }));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('KYC'));
  expect(mockUpdateProfile).toHaveBeenCalledWith({ full_name: 'Fixture Creator', city: 'Durban' });
  expect(requestCreatorEnrolment).toHaveBeenCalledWith('model');
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});
