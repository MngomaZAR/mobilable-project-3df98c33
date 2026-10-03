import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';
import { requireCurrentAuthenticatedUser } from '../config/currentUser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type DeletionResult = {
  id: string;
  status: 'pending' | 'processing' | 'blocked' | 'completed';
  receipt_token?: string;
  already_requested?: boolean;
  blocked_reason?: string | null;
  completed_at?: string | null;
};

const RECEIPT_KEY = 'papzi_account_deletion_receipt';
const SECURE_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const saveReceipt = async (receipt: string) => {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(RECEIPT_KEY, receipt);
    return;
  }
  await SecureStore.setItemAsync(RECEIPT_KEY, receipt, SECURE_OPTIONS);
  await AsyncStorage.removeItem(RECEIPT_KEY);
};

const loadReceipt = async () => {
  if (Platform.OS === 'web') return AsyncStorage.getItem(RECEIPT_KEY);
  const secured = await SecureStore.getItemAsync(RECEIPT_KEY, SECURE_OPTIONS);
  if (secured !== null) return secured;
  const legacy = await AsyncStorage.getItem(RECEIPT_KEY);
  if (legacy) await saveReceipt(legacy);
  return legacy;
};

export const requestAccountDeletion = async (reason: string = '') => {
  await requireCurrentAuthenticatedUser();
  const result = await apiClient.post<DeletionResult>('/account/deletion', { reason, confirmation: 'DELETE' }, { token: await getApiAccessToken() });
  if (result.receipt_token) await saveReceipt(result.receipt_token);
  return result;
};

export const getAccountDeletionStatus = async (): Promise<DeletionResult | null> => {
  const receipt = await loadReceipt();
  if (!receipt) return null;
  return apiClient.post<DeletionResult>('/account/deletion/status', { receipt_token: receipt });
};
