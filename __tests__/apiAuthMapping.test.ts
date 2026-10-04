import { mapSupabaseUser } from '../src/utils/mappings';
import { getEffectiveRole } from '../src/utils/userRole';

jest.mock('../src/config/environment', () => ({ environment: { backendProvider: 'api' } }));
jest.mock('../src/config/apiClient', () => ({
  hasApiBackend: true,
  apiClient: { get: jest.fn(), post: jest.fn() },
  ApiClientError: class extends Error { status = 401; },
}));
jest.mock('../src/services/sessionStorage', () => ({
  sessionStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('../src/services/legacyProviderClient', () => ({ hasLegacyDb: false, legacyDb: null }));
jest.mock('../src/config/nhostClient', () => ({ hasNhost: false }));
jest.mock('../src/config/supabaseClient', () => ({ hasSupabase: false }));

describe('API authentication capability mapping', () => {
  let client: { get: jest.Mock; post: jest.Mock };
  let sessions: typeof import('../src/config/apiSession');
  let auth: typeof import('../src/services/backendGateway')['backendDb']['auth'];
  let currentUser: typeof import('../src/config/currentUser');

  beforeEach(() => {
    jest.resetModules();
    client = jest.requireMock('../src/config/apiClient').apiClient;
    sessions = require('../src/config/apiSession');
    auth = require('../src/services/backendGateway').backendDb.auth;
    currentUser = require('../src/config/currentUser');
  });

  it('carries a sign-in capability to admin navigation without altering the profile role', async () => {
    const user = { id: 'owner', is_admin: true, user_metadata: { role: 'client' } };
    client.post.mockResolvedValue({ session: { access_token: 'test-token', user }, user });
    const result = await auth.signInWithPassword({ email: 'qa@example.test', password: 'test-password' });
    expect(result.error).toBeNull();
    const mapped = mapSupabaseUser(result.data.user, 'client', { role: 'client' });
    expect(mapped.role).toBe('client');
    expect(getEffectiveRole(mapped)).toBe('admin');
  });

  it('validates a restored session before auth bootstrap and preserves capability in current-user mapping', async () => {
    const storage = jest.requireMock('../src/services/sessionStorage').sessionStorage;
    storage.getItem.mockResolvedValue(JSON.stringify({ access_token: 'test-token', user: { id: 'owner', is_admin: true } }));
    client.get.mockResolvedValue({ user: { id: 'owner', email: 'qa@example.test', is_admin: true, user_metadata: { role: 'client' } } });
    const [bootstrap, user] = await Promise.all([auth.getSession(), currentUser.getCurrentAuthenticatedUser()]);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(bootstrap.data.session?.user?.is_admin).toBe(true);
    expect(user).toEqual({ id: 'owner', email: 'qa@example.test', is_admin: true });
  });

  it('auth/me replaces cached capability rather than falling back to stale admin data', async () => {
    await sessions.setApiSession({ access_token: 'test-token', user: { id: 'owner', is_admin: true } });
    client.get.mockResolvedValue({ user: { id: 'owner', is_admin: false, user_metadata: { role: 'model' } } });
    const result = await auth.getUser();
    const mapped = mapSupabaseUser(result.data.user, 'model', { role: 'model' });
    expect(getEffectiveRole(mapped)).toBe('model');
    expect(mapped.is_admin).toBe(false);
  });

  it('does not expose cached admin session when bootstrap cannot validate the server', async () => {
    await sessions.setApiSession({ access_token: 'test-token', user: { id: 'owner', is_admin: true } });
    client.get.mockRejectedValue(new Error('server unavailable'));
    const result = await auth.getSession();
    expect(result.data.session).toBeNull();
    expect(result.error?.message).toBe('server unavailable');
    expect(sessions.getCachedApiSession()?.user?.is_admin).toBe(false);
  });

  it('initial auth events use validated capability and respect unsubscribe', async () => {
    await sessions.setApiSession({ access_token: 'test-token', user: { id: 'owner', is_admin: true } });
    client.get.mockResolvedValue({ user: { id: 'owner', is_admin: false } });
    const callback = jest.fn();
    auth.onAuthStateChange(callback);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledWith('INITIAL_SESSION', expect.objectContaining({ user: { id: 'owner', is_admin: false } }));
    const cancelled = jest.fn();
    const subscription = auth.onAuthStateChange(cancelled);
    subscription.data.subscription.unsubscribe();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancelled).not.toHaveBeenCalled();
  });
});
