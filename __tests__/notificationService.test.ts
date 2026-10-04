import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getLastPushPayload, registerForPushNotificationsAsync, subscribeToPushResponses } from '../src/services/notificationService';
import { notificationDeepLink } from '../src/utils/notificationNavigation';

jest.mock('expo-constants', () => ({ __esModule: true, default: { executionEnvironment: 'standalone', appOwnership: null,
  expoConfig: { extra: { eas: { projectId: 'existing-eas-project' } } } }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('../src/services/backendGateway', () => ({ backendDb: {} }));
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'default', setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), getExpoPushTokenAsync: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(), addNotificationResponseReceivedListener: jest.fn(),
}));
let os: typeof Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  (Constants as any).executionEnvironment = 'standalone';
  (Constants as any).appOwnership = null;
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExpoPushToken[fixture-only]' });
});
afterEach(() => { Object.defineProperty(Platform, 'OS', { configurable: true, value: os }); });

test('SDK 54 standalone with null appOwnership registers its existing EAS project, not Expo Go', async () => {
  expect(await registerForPushNotificationsAsync()).toBe('ExpoPushToken[fixture-only]');
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'existing-eas-project' });
});

test('Expo Go and web do not attempt unsupported remote notification registration', async () => {
  (Constants as any).executionEnvironment = 'storeClient';
  expect(await registerForPushNotificationsAsync()).toBeNull();
  (Constants as any).executionEnvironment = 'standalone';
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  expect(await registerForPushNotificationsAsync()).toBeNull();
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});

test('cold-start responses return only default taps and fail closed on SDK errors', async () => {
  const data = { user_id: 'user-1', booking_id: 'booking-1' };
  (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue({ actionIdentifier: 'default', notification: { request: { content: { data } } } });
  expect(await getLastPushPayload()).toEqual(data);
  (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue({ actionIdentifier: 'decline' });
  expect(await getLastPushPayload()).toBeNull();
  (Notifications.getLastNotificationResponseAsync as jest.Mock).mockRejectedValue(new Error('Native module unavailable'));
  expect(await getLastPushPayload()).toBeNull();
});

test('foreground listener only forwards default taps and removes its subscription', async () => {
  const remove = jest.fn();
  (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValue({ remove });
  const listener = jest.fn();
  const unsubscribe = subscribeToPushResponses(listener);
  await Promise.resolve(); await Promise.resolve();
  const callback = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock.calls[0][0];
  const data = { user_id: 'user-1', conversation_id: 'chat-1' };
  callback({ actionIdentifier: 'default', notification: { request: { content: { data } } } });
  callback({ actionIdentifier: 'other' });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith(data);
  unsubscribe();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('a cancelled pending subscription never installs a listener', async () => {
  const unsubscribe = subscribeToPushResponses(jest.fn());
  unsubscribe();
  await Promise.resolve(); await Promise.resolve();
  expect(Notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
});

test('notification navigation permits only current-recipient booking/chat references, not arbitrary URLs', () => {
  expect(notificationDeepLink({ user_id: 'user-1', booking_id: 'booking-1', url: 'https://attacker.invalid' }, 'user-1')).toBe('papzi://booking/booking-1');
  expect(notificationDeepLink({ user_id: 'user-1', conversation_id: 'chat/1' }, 'user-1')).toBe('papzi://chat/chat%2F1');
  expect(notificationDeepLink({ user_id: 'other', booking_id: 'booking-1' }, 'user-1')).toBeNull();
  expect(notificationDeepLink({ user_id: 'user-1', url: 'papzi://payment/booking-1' }, 'user-1')).toBeNull();
  expect(notificationDeepLink({ user_id: 'user-1', booking_id: 'booking-1\0' }, 'user-1')).toBeNull();
  expect(notificationDeepLink({ user_id: 'user-1', booking_id: 'booking-1' })).toBeNull();
});
