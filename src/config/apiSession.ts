import { apiClient, ApiClientError } from './apiClient';
import { sessionStorage } from '../services/sessionStorage';

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

let cachedSession: ApiSession | null = null;
let hydrated = false;
let hydration: Promise<ApiSession | null> | null = null;
let refresh: Promise<ApiSession | null> | null = null;
let generation = 0;

export const hydrateApiSession = async () => {
  if (hydrated) return cachedSession;
  if (!hydration) hydration = (async () => {
    const startingGeneration = generation;
    // Storage errors must be retryable, not treated as corrupt JSON or an absent account.
    const stored = await sessionStorage.getItem();
    if (generation !== startingGeneration) return cachedSession;
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Invalid stored session');
        }
        const session = parsed as ApiSession;
        if ((session.access_token != null && typeof session.access_token !== 'string') ||
            (session.refresh_token != null && typeof session.refresh_token !== 'string') ||
            (session.expires_at != null && (typeof session.expires_at !== 'number' || !Number.isFinite(session.expires_at)))) {
          throw new Error('Invalid stored session');
        }
        cachedSession = session;
      } catch {
        cachedSession = null;
        await sessionStorage.removeItem();
      }
    } else {
      cachedSession = null;
    }
    hydrated = true;
    return cachedSession;
  })().finally(() => { hydration = null; });
  return hydration;
};

export const getApiSession = async () => {
  await hydrateApiSession();
  if (cachedSession?.expires_at && cachedSession.expires_at <= Date.now() / 1000 + 60) {
    return refreshApiSession();
  }
  return cachedSession;
};

export const refreshApiSession = async (): Promise<ApiSession | null> => {
  await hydrateApiSession();
  if (refresh) return refresh;
  const session = cachedSession;
  if (!session?.refresh_token) return null;
  const startingGeneration = generation;
  refresh = (async () => {
    try {
      const response = await apiClient.post<{ session: ApiSession }>('/auth/refresh', {
        refresh_token: session.refresh_token,
      });
      // A response from an old account must not restore a signed-out session.
      if (generation !== startingGeneration) return cachedSession;
      await setApiSession(response.session);
      return cachedSession;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401 && generation === startingGeneration) {
        await clearApiSession();
      }
      throw error;
    } finally {
      refresh = null;
    }
  })();
  return refresh;
};

export const getCachedApiSession = () => cachedSession;

export const getApiAccessToken = async () => {
  const session = await getApiSession();
  return session?.access_token ?? null;
};

export const setApiSession = async (session: ApiSession | null) => {
  generation += 1;
  cachedSession = session;
  hydrated = true;
  if (!session) {
    await sessionStorage.removeItem();
    return;
  }
  await sessionStorage.setItem(JSON.stringify(session));
};

export const clearApiSession = async () => {
  await setApiSession(null);
};
