import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { apiClient } from '../../src/config/apiClient';
import { getAccountDeletionStatus, requestAccountDeletion } from '../../src/services/accountService';

jest.mock('../../src/config/apiClient', () => ({ apiClient: { post: jest.fn() } }));
jest.mock('../../src/config/apiSession', () => ({ getApiAccessToken: jest.fn().mockResolvedValue('session-token') }));
jest.mock('../../src/config/currentUser', () => ({ requireCurrentAuthenticatedUser: jest.fn().mockResolvedValue({ id: 'owner' }) }));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', getItemAsync: jest.fn(), setItemAsync: jest.fn(),
}));

const post = apiClient.post as jest.Mock;
const key = 'papzi_account_deletion_receipt';

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
});

test('native deletion receipt is secured and request is not reported completed', async () => {
  post.mockResolvedValue({ id: 'request', status: 'pending', receipt_token: 'private-receipt' });
  const result = await requestAccountDeletion('Requested');
  expect(post).toHaveBeenCalledWith('/account/deletion', { reason: 'Requested', confirmation: 'DELETE' }, { token: 'session-token' });
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(key, 'private-receipt', { keychainAccessible: 'device-only' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(result.status).toBe('pending');
});

test('receipt queries status without reusing a revoked login session', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('private-receipt');
  post.mockResolvedValue({ id: 'request', status: 'completed' });
  expect((await getAccountDeletionStatus())?.status).toBe('completed');
  expect(post).toHaveBeenCalledWith('/account/deletion/status', { receipt_token: 'private-receipt' });
});

test('storage and request errors propagate without a fake receipt', async () => {
  post.mockRejectedValueOnce(new Error('Network unavailable'));
  await expect(requestAccountDeletion()).rejects.toThrow('Network unavailable');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
