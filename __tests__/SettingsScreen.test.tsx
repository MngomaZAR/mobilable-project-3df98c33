import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform, Share } from 'react-native';
import SettingsScreen from '../src/screens/SettingsScreen';
import { apiClient } from '../src/config/apiClient';
import { getApiAccessToken } from '../src/config/apiSession';
import { useAppData } from '../src/store/AppDataContext';

jest.mock('../src/config/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/config/apiSession', () => ({ getApiAccessToken: jest.fn() }));
jest.mock('../src/config/environment', () => ({ environment: { env: 'test', region: 'ZA' } }));
jest.mock('../src/store/AppDataContext', () => ({ useAppData: jest.fn() }));
jest.mock('../src/store/ThemeContext', () => ({
  useTheme: () => ({
    colors: { bg: '#fff', card: '#fff', border: '#ccc', text: '#111', textSecondary: '#444', textMuted: '#666', accent: '#007AFF', destructive: '#c00', successGreen: '#090' },
    isDark: false, themeMode: 'light', setThemeMode: jest.fn(),
  }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image-picker', () => ({ requestMediaLibraryPermissionsAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ value }: { value: string }) => React.createElement(Text, { testID: 'profile-qr' }, value);
});
jest.mock('../src/services/accountService', () => ({ requestAccountDeletion: jest.fn() }));
jest.mock('../src/services/notificationService', () => ({ registerForPushNotificationsAsync: jest.fn(), savePushTokenAsync: jest.fn() }));
jest.mock('../src/services/backendGateway', () => ({
  backendDb: { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) },
}));

const current = { id: 'current', current: true, created_at: '2026-10-03T08:00:00Z', expires_at: '2026-11-03T08:00:00Z' };
const other = { ...current, id: 'other', current: false };
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

describe('Settings reliability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'ios');
    (useAppData as jest.Mock).mockReturnValue({
      currentUser: { id: 'me', email: 'me@example.com', role: 'client' },
      resetState: jest.fn(), saving: false, signOut: jest.fn(), updateProfilePicture: jest.fn(),
    });
    (getApiAccessToken as jest.Mock).mockResolvedValue('access-token');
    (apiClient.get as jest.Mock).mockResolvedValue({ sessions: [current, other] });
    (apiClient.post as jest.Mock).mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });

  it('does not offer fake biometrics, 2FA, export or language selection', async () => {
    const view = render(<SettingsScreen />);
    await waitFor(() => expect(view.getByText('English')).toBeTruthy());
    for (const label of ['Biometric Lock: unavailable', 'Two-Factor Auth (2FA): unavailable', 'Download My Data (GDPR): unavailable']) {
      expect(view.getByLabelText(label).props.accessibilityState).toEqual({ disabled: true });
      expect(view.getByLabelText(label).props.onPress).toBeUndefined();
    }
    expect(view.getByLabelText('Language: English').props.onPress).toBeUndefined();
    expect(view.queryByText('Zulu (isiZulu)')).toBeNull();
    expect(view.queryByText('Share QR Code')).toBeNull();
  });

  it('shares the same supported profile deep link shown by the QR code', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    const view = render(<SettingsScreen />);
    expect(view.getByTestId('profile-qr').props.children).toBe('papzi://profile/me');
    fireEvent.press(view.getByRole('button', { name: 'Share Profile Link' }));
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ message: 'papzi://profile/me' })));
  });

  it('hides the QR code and disables session controls without an account', () => {
    (useAppData as jest.Mock).mockReturnValue({ currentUser: null });
    const view = render(<SettingsScreen />);
    expect(view.queryByTestId('profile-qr')).toBeNull();
    expect(view.getByRole('button', { name: 'Active Sessions' })).toBeDisabled();
  });

  it('copies the profile link in browsers without Web Share', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText } } });
    const view = render(<SettingsScreen />);
    fireEvent.press(view.getByRole('button', { name: 'Copy Profile Link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('papzi://profile/me'));
    expect(await view.findByText('Profile Link Copied')).toBeTruthy();
  });

  it('disables sharing when the browser has neither share nor clipboard', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    const view = render(<SettingsScreen />);
    expect(view.getByRole('button', { name: 'Sharing unavailable' })).toBeDisabled();
  });

  it('shows sharing failures without claiming success', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('share failed'));
    const view = render(<SettingsScreen />);
    fireEvent.press(view.getByRole('button', { name: 'Share Profile Link' }));
    expect(await view.findByText('Sharing Failed')).toBeTruthy();
    expect(view.queryByText('Profile Link Copied')).toBeNull();
  });

  it('loads real sessions with the current access token and revokes another session', async () => {
    const view = render(<SettingsScreen />);
    fireEvent.press(view.getByRole('button', { name: 'Active Sessions' }));
    expect(await view.findByText('Current Session')).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledWith('/auth/sessions', { token: 'access-token' });
    expect(view.queryByRole('button', { name: 'Revoke session current' })).toBeNull();
    (apiClient.get as jest.Mock).mockResolvedValue({ sessions: [current] });
    fireEvent.press(view.getByRole('button', { name: 'Revoke session other' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/auth/sessions/revoke', { session_id: 'other' }, { token: 'access-token' }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.queryByText('Other Session')).toBeNull());
  });

  it('reports session load errors and supports retry', async () => {
    (apiClient.get as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    const view = render(<SettingsScreen />);
    fireEvent.press(view.getByRole('button', { name: 'Active Sessions' }));
    expect(await view.findByText('Could not load sessions. Please try again.')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Refresh sessions' }));
    expect(await view.findByText('Current Session')).toBeTruthy();
  });

  it('rejects malformed session rows without crashing or offering revocation', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ sessions: [null] });
    const view = render(<SettingsScreen />);
    fireEvent.press(view.getByRole('button', { name: 'Active Sessions' }));
    expect(await view.findByText('Could not load sessions. Please try again.')).toBeTruthy();
    expect(view.queryByText('Revoke')).toBeNull();
  });

  it('preserves the displayed session when revocation fails', async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(new Error('denied'));
    const view = render(<SettingsScreen />);
    fireEvent.press(view.getByRole('button', { name: 'Active Sessions' }));
    await view.findByText('Other Session');
    fireEvent.press(view.getByRole('button', { name: 'Revoke session other' }));
    expect(await view.findByText('Could not revoke this session. Please try again.')).toBeTruthy();
    expect(view.getByText('Other Session')).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('never calls the session API without an access token', async () => {
    (getApiAccessToken as jest.Mock).mockResolvedValue(null);
    const view = render(<SettingsScreen />);
    fireEvent.press(view.getByRole('button', { name: 'Active Sessions' }));
    expect(await view.findByText('Could not load sessions. Please try again.')).toBeTruthy();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('discards an old account response when the account changes', async () => {
    let finish!: (response: unknown) => void;
    (apiClient.get as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<SettingsScreen />);
    fireEvent.press(view.getByRole('button', { name: 'Active Sessions' }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
    (useAppData as jest.Mock).mockReturnValue({ currentUser: { id: 'new-account', role: 'client' } });
    (apiClient.get as jest.Mock).mockResolvedValue({ sessions: [] });
    view.rerender(<SettingsScreen />);
    expect(await view.findByText('No active sessions.')).toBeTruthy();
    await act(async () => { finish({ sessions: [other] }); });
    expect(view.queryByText('Other Session')).toBeNull();
  });
});
