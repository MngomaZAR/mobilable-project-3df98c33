import { createClient } from '@nhost/nhost-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type SessionStorageBackend, type StoredSession } from '@nhost/nhost-js/session';
import { environment } from './environment';

const subdomain = String(environment.EXPO_PUBLIC_NHOST_SUBDOMAIN ?? '').trim();
const region = String(environment.EXPO_PUBLIC_NHOST_REGION ?? '').trim();
const SESSION_STORAGE_KEY = 'nhostSession';
let cachedSession: StoredSession | null = null;
let hydrated = false;

export const hasNhost = environment.backendProvider === 'nhost' && Boolean(subdomain && region);

export const nhostSessionStorage: SessionStorageBackend = {
  get: () => cachedSession,
  set: (value) => {
    cachedSession = value;
    void AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value));
  },
  remove: () => {
    cachedSession = null;
    void AsyncStorage.removeItem(SESSION_STORAGE_KEY);
  },
};

export const hydrateNhostSessionStorage = async () => {
  if (hydrated) return cachedSession;
  hydrated = true;
  try {
    const stored = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
    cachedSession = stored ? (JSON.parse(stored) as StoredSession) : null;
  } catch {
    cachedSession = null;
    void AsyncStorage.removeItem(SESSION_STORAGE_KEY);
  }
  return cachedSession;
};

export const nhost = createClient({
  subdomain: subdomain || 'placeholder',
  region: region || 'eu-central-1',
  storage: nhostSessionStorage,
});

export const getNhostSession = () => nhost.getUserSession();
