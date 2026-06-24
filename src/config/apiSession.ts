import AsyncStorage from '@react-native-async-storage/async-storage';

export type ApiSessionUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
};

export type ApiSession = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  user?: ApiSessionUser | null;
};

const SESSION_STORAGE_KEY = 'papziApiSession';

let cachedSession: ApiSession | null = null;
let hydrated = false;

export const hydrateApiSession = async () => {
  if (hydrated) return cachedSession;
  hydrated = true;
  try {
    const stored = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
    cachedSession = stored ? (JSON.parse(stored) as ApiSession) : null;
  } catch {
    cachedSession = null;
    void AsyncStorage.removeItem(SESSION_STORAGE_KEY);
  }
  return cachedSession;
};

export const getApiSession = async () => {
  await hydrateApiSession();
  return cachedSession;
};

export const getCachedApiSession = () => cachedSession;

export const getApiAccessToken = async () => {
  const session = await getApiSession();
  return session?.access_token ?? null;
};

export const setApiSession = async (session: ApiSession | null) => {
  cachedSession = session;
  hydrated = true;
  if (!session) {
    await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
};

export const clearApiSession = async () => {
  await setApiSession(null);
};
