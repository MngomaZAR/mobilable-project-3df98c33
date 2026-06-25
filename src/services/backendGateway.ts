import { ApiClientError, apiClient, hasApiBackend } from '../config/apiClient';
import { environment } from '../config/environment';
import {
  ApiSession,
  clearApiSession,
  getApiAccessToken,
  getApiSession,
  setApiSession,
} from '../config/apiSession';
import {
  legacyDb,
  hasLegacyDb,
  legacyFunctionUrl as backendFunctionUrl,
  legacyPublishableKey as backendPublishableKey,
  legacyRestUrl as backendRestUrl,
} from './legacyProviderClient';

type BackendError = { message: string; status?: number; body?: unknown; code?: string };
type QueryResult<T = any> = { data: T | null; error: BackendError | null; count?: number | null };
type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'contains' | 'or' | 'match' | 'ilike';

type QueryPayload = {
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  select?: string;
  filters: Array<{ op: FilterOp; column?: string; value?: unknown }>;
  order?: Array<{ column: string; ascending: boolean }>;
  limit?: number;
  range?: { from: number; to: number };
  payload?: unknown;
  single?: boolean;
  maybeSingle?: boolean;
  count?: string | null;
  head?: boolean;
  onConflict?: string | null;
};

type AuthResponse = {
  session?: ApiSession | null;
  user?: ApiSession['user'] | null;
  url?: string;
};

type RealtimePayload = {
  eventType?: string;
  new: any;
  old: any;
};

type BackendChannel = {
  on: (event: string, filter: Record<string, unknown>, callback: (payload: RealtimePayload) => void | Promise<void>) => BackendChannel;
  subscribe: () => BackendChannel;
  track: (payload: Record<string, unknown>) => Promise<void>;
  presenceState: <T>() => Record<string, T[]>;
  unsubscribe: () => void;
};

type BackendDb = {
  from: (table: string) => ApiQueryBuilder<any>;
  rpc: (name: string, params?: Record<string, unknown>) => Promise<QueryResult>;
  auth: {
    getSession: () => Promise<{ data: { session: ApiSession | null }; error: BackendError | null }>;
    getUser: () => Promise<{ data: { user: ApiSession['user'] | null }; error: BackendError | null }>;
    signInWithPassword: (payload: { email: string; password: string }) => Promise<{ data: { session: ApiSession | null; user: ApiSession['user'] | null }; error: BackendError | null }>;
    signUpWithPassword: (payload: { email: string; password: string; options?: Record<string, unknown> }) => Promise<{ data: { session: ApiSession | null; user: ApiSession['user'] | null }; error: BackendError | null }>;
    signOut: () => Promise<{ error: BackendError | null }>;
    signInWithOAuth: (payload: { provider: string; options?: Record<string, unknown> }) => Promise<{ data: { url: string | null }; error: BackendError | null }>;
    setSession: (session: ApiSession) => Promise<{ data: { session: ApiSession }; error: BackendError | null }>;
    exchangeCodeForSession: (code: string, codeVerifier?: string | null) => Promise<{ data: { session: ApiSession | null; user: ApiSession['user'] | null }; error: BackendError | null }>;
    refreshSession: () => Promise<{ data: { session: ApiSession | null; user: ApiSession['user'] | null }; error: BackendError | null }>;
    updateUser: (attributes: Record<string, unknown>) => Promise<{ data: { user: ApiSession['user'] | null }; error: BackendError | null }>;
    onAuthStateChange: (
      callback: (event: string, session: ApiSession | null) => void | Promise<void>
    ) => { data: { subscription: { unsubscribe: () => void } } };
  };
  channel: (name: string) => BackendChannel;
  removeChannel: (channel: BackendChannel) => void;
};

const isApiProvider = environment.backendProvider === 'api';

const toBackendError = (error: unknown, fallback = 'Request failed.'): BackendError => {
  if (error instanceof ApiClientError) {
    return { message: error.message || fallback, status: error.status, body: error.body };
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return { message: String((error as { message?: unknown }).message ?? fallback) };
  }
  return { message: fallback };
};

const toAuthUser = (session: ApiSession | null | undefined, fallbackUser?: ApiSession['user'] | null) =>
  session?.user ?? fallbackUser ?? null;

const requestWithToken = async <T,>(path: string, body?: unknown) => {
  const token = await getApiAccessToken();
  return apiClient.post<T>(path, body, { token });
};

class ApiQueryBuilder<T = any> implements PromiseLike<QueryResult<T>> {
  private payload: QueryPayload = {
    action: 'select',
    filters: [],
  };

  constructor(private readonly table: string) {}

  select(columns = '*', options?: { count?: string; head?: boolean }) {
    this.payload.action = this.payload.action === 'delete' ? 'delete' : this.payload.action;
    this.payload.select = columns || '*';
    this.payload.count = options?.count ?? null;
    this.payload.head = Boolean(options?.head);
    return this;
  }

  insert(value: unknown) {
    this.payload.action = 'insert';
    this.payload.payload = value;
    return this;
  }

  update(value: unknown) {
    this.payload.action = 'update';
    this.payload.payload = value;
    return this;
  }

  upsert(value: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.payload.action = 'upsert';
    this.payload.payload = value;
    this.payload.onConflict = options?.onConflict ?? null;
    return this;
  }

  delete() {
    this.payload.action = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    this.payload.filters.push({ op: 'eq', column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.payload.filters.push({ op: 'neq', column, value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.payload.filters.push({ op: 'gt', column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.payload.filters.push({ op: 'gte', column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.payload.filters.push({ op: 'lt', column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.payload.filters.push({ op: 'lte', column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.payload.filters.push({ op: 'in', column, value: values });
    return this;
  }

  is(column: string, value: unknown) {
    this.payload.filters.push({ op: 'is', column, value });
    return this;
  }

  contains(column: string, value: unknown) {
    this.payload.filters.push({ op: 'contains', column, value });
    return this;
  }

  ilike(column: string, value: unknown) {
    this.payload.filters.push({ op: 'ilike', column, value });
    return this;
  }

  match(values: Record<string, unknown>) {
    this.payload.filters.push({ op: 'match', value: values });
    return this;
  }

  or(value: string) {
    this.payload.filters.push({ op: 'or', value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.payload.order = [...(this.payload.order ?? []), { column, ascending: options?.ascending !== false }];
    return this;
  }

  limit(value: number) {
    this.payload.limit = value;
    return this;
  }

  range(from: number, to: number) {
    this.payload.range = { from, to };
    return this;
  }

  single() {
    this.payload.single = true;
    return this;
  }

  maybeSingle() {
    this.payload.maybeSingle = true;
    return this;
  }

  async execute(): Promise<QueryResult<T>> {
    try {
      const data = await requestWithToken<QueryResult<T>>(`/data/${encodeURIComponent(this.table)}`, this.payload);
      return {
        data: (data as QueryResult<T>).data ?? null,
        error: (data as QueryResult<T>).error ?? null,
        count: (data as QueryResult<T>).count ?? null,
      };
    } catch (error) {
      return { data: null, error: toBackendError(error), count: null };
    }
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

const createApiBackendDb = () => {
  const auth = {
    getSession: async () => {
      const session = await getApiSession();
      return { data: { session }, error: null };
    },
    getUser: async () => {
      try {
        const session = await getApiSession();
        if (!session?.access_token) return { data: { user: null }, error: null };
        const response = await apiClient.get<AuthResponse>('/auth/me', { token: session.access_token });
        const user = response.user ?? session.user ?? null;
        if (user) await setApiSession({ ...session, user });
        return { data: { user }, error: null };
      } catch (error) {
        return { data: { user: null }, error: toBackendError(error, 'Unable to load current user.') };
      }
    },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      try {
        const response = await apiClient.post<AuthResponse>('/auth/sign-in', { email, password });
        const session = response.session ?? null;
        await setApiSession(session);
        return { data: { session, user: toAuthUser(session, response.user) }, error: null };
      } catch (error) {
        return { data: { session: null, user: null }, error: toBackendError(error, 'Unable to sign in.') };
      }
    },
    signUpWithPassword: async ({
      email,
      password,
      options,
    }: {
      email: string;
      password: string;
      options?: Record<string, unknown>;
    }) => {
      try {
        const response = await apiClient.post<AuthResponse>('/auth/sign-up', { email, password, options });
        const session = response.session ?? null;
        await setApiSession(session);
        return { data: { session, user: toAuthUser(session, response.user) }, error: null };
      } catch (error) {
        return { data: { session: null, user: null }, error: toBackendError(error, 'Unable to sign up.') };
      }
    },
    signOut: async () => {
      try {
        const token = await getApiAccessToken();
        if (token) await apiClient.post('/auth/sign-out', undefined, { token }).catch(() => undefined);
      } finally {
        await clearApiSession();
      }
      return { error: null };
    },
    signInWithOAuth: async ({ provider, options }: { provider: string; options?: Record<string, unknown> }) => {
      try {
        const response = await apiClient.post<AuthResponse>('/auth/oauth', { provider, options });
        return { data: { url: response.url ?? null }, error: null };
      } catch (error) {
        return { data: { url: null }, error: toBackendError(error, 'OAuth is not available.') };
      }
    },
    setSession: async (session: ApiSession) => {
      await setApiSession(session);
      return { data: { session }, error: null };
    },
    exchangeCodeForSession: async (code: string, codeVerifier?: string | null) => {
      try {
        const response = await apiClient.post<AuthResponse>('/auth/exchange', { code, codeVerifier });
        const session = response.session ?? null;
        await setApiSession(session);
        return { data: { session, user: toAuthUser(session, response.user) }, error: null };
      } catch (error) {
        return { data: { session: null, user: null }, error: toBackendError(error, 'Unable to complete sign in.') };
      }
    },
    refreshSession: async () => {
      try {
        const session = await getApiSession();
        const response = await apiClient.post<AuthResponse>('/auth/refresh', {
          refresh_token: session?.refresh_token ?? null,
        });
        const nextSession = response.session ?? session ?? null;
        await setApiSession(nextSession);
        return { data: { session: nextSession, user: toAuthUser(nextSession, response.user) }, error: null };
      } catch (error) {
        return { data: { session: null, user: null }, error: toBackendError(error, 'Unable to refresh session.') };
      }
    },
    updateUser: async (attributes: Record<string, unknown>) => {
      try {
        const response = await requestWithToken<AuthResponse>('/auth/update-user', attributes);
        const session = response.session ?? (await getApiSession());
        if (session) await setApiSession({ ...session, user: response.user ?? session.user ?? null });
        return { data: { user: response.user ?? session?.user ?? null }, error: null };
      } catch (error) {
        return { data: { user: null }, error: toBackendError(error, 'Unable to update user.') };
      }
    },
    onAuthStateChange: (callback: (event: string, session: ApiSession | null) => void) => {
      void getApiSession().then((session) => callback(session ? 'INITIAL_SESSION' : 'SIGNED_OUT', session));
      return {
        data: {
          subscription: {
            unsubscribe: () => undefined,
          },
        },
      };
    },
  };

  const channel = (_name: string): BackendChannel => {
    const channelApi: BackendChannel = {
      on: () => channelApi,
      subscribe: () => channelApi,
      track: async () => undefined,
      presenceState: () => ({}),
      unsubscribe: () => undefined,
    };
    return channelApi;
  };

  return {
    from: (table: string) => new ApiQueryBuilder(table),
    rpc: async (name: string, params?: Record<string, unknown>) => {
      try {
        return await requestWithToken<QueryResult>(`/rpc/${encodeURIComponent(name)}`, params ?? {});
      } catch (error) {
        return { data: null, error: toBackendError(error, `RPC ${name} failed.`) };
      }
    },
    auth,
    channel,
    removeChannel: () => undefined,
  };
};

export const hasBackendProvider = isApiProvider ? hasApiBackend : hasLegacyDb;
export const backendDb: BackendDb = (isApiProvider ? createApiBackendDb() : legacyDb) as BackendDb;
export { backendFunctionUrl, backendPublishableKey, backendRestUrl };
