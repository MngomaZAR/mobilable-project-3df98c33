import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SESSION_STORAGE_KEY = 'papziApiSession';
const SECURE_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

let pending: Promise<unknown> = Promise.resolve();

// Migration, writes and deletion must finish in order, especially during sign-out.
const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = pending.then(operation);
  pending = result.catch(() => undefined);
  return result;
};

export const sessionStorage = {
  getItem: () => enqueue(async () => {
    if (Platform.OS === 'web') return AsyncStorage.getItem(SESSION_STORAGE_KEY);

    const secured = await SecureStore.getItemAsync(SESSION_STORAGE_KEY, SECURE_OPTIONS);
    if (secured !== null) {
      await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
      return secured;
    }

    const legacy = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
    if (legacy !== null) {
      // Keep the old value until the secure write succeeds; never fall back on a native error.
      await SecureStore.setItemAsync(SESSION_STORAGE_KEY, legacy, SECURE_OPTIONS);
      await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
    }
    return legacy;
  }),

  setItem: (value: string) => enqueue(async () => {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(SESSION_STORAGE_KEY, value);
      return;
    }
    await SecureStore.setItemAsync(SESSION_STORAGE_KEY, value, SECURE_OPTIONS);
    await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
  }),

  removeItem: () => enqueue(async () => {
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    // Attempt both removals even if one fails, so a legacy value cannot survive silently.
    const results = await Promise.allSettled([
      SecureStore.deleteItemAsync(SESSION_STORAGE_KEY, SECURE_OPTIONS),
      AsyncStorage.removeItem(SESSION_STORAGE_KEY),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
  }),
};
