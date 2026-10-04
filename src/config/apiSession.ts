import { apiClient, ApiClientError } from './apiClient';
import { sessionStorage } from '../services/sessionStorage';

export type ApiSessionUser = {
  id: string;
  email?: string | null;
  is_admin?: boolean;
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
let validation: Promise<ApiSession | null> | null = null;
let validationGeneration = 0;
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
        // A stored capability is not proof of the current server allowlist.
        cachedSession = { ...session, user: session.user ? { ...session.user, is_admin: false } : session.user };
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

export const validateApiSession = async (): Promise<ApiSession | null> => {
  const session = await getApiSession();
  if (!session?.access_token) return null;
  if (validation && validationGeneration === generation) return validation;
  const startingGeneration = generation;
  validationGeneration = startingGeneration;
  validation = (async () => {
    try {
      const response = await apiClient.get<{ user?: ApiSessionUser | null }>('/auth/me', { token: session.access_token! });
      if (generation !== startingGeneration) return null;
      if (!response.user?.id || (session.user?.id && response.user.id !== session.user.id)) {
        throw new Error('Unable to validate the current account.');
      }
      await setApiSession({ ...session, user: { ...response.user, is_admin: response.user.is_admin === true } });
      return generation === startingGeneration + 1 ? cachedSession : null;
    } catch (error) {
      if (generation === startingGeneration) {
        if (error instanceof ApiClientError && error.status === 401) {
          await clearApiSession();
        } else if (session.user) {
          await setApiSession({ ...session, user: { ...session.user, is_admin: false } });
        }
      }
      throw error;
    } finally {
      if (validationGeneration === startingGeneration) validation = null;
    }
  })();
  return validation;
};

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
