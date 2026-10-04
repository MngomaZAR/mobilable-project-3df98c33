jest.mock('../src/config/apiClient', () => ({
  apiClient: { post: jest.fn(), get: jest.fn() },
  ApiClientError: class extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } },
}));

jest.mock('../src/services/sessionStorage', () => ({
  sessionStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

describe('API session persistence and refresh', () => {
  let apiClient: { post: jest.Mock; get: jest.Mock };
  let storage: { getItem: jest.Mock; setItem: jest.Mock; removeItem: jest.Mock };
  let session: typeof import('../src/config/apiSession');
  let clearApiSession: typeof session.clearApiSession;
  let getApiAccessToken: typeof session.getApiAccessToken;
  let setApiSession: typeof session.setApiSession;

  beforeEach(() => {
    jest.resetModules();
    apiClient = jest.requireMock('../src/config/apiClient').apiClient;
    storage = jest.requireMock('../src/services/sessionStorage').sessionStorage;
    storage.getItem.mockResolvedValue(null);
    storage.setItem.mockResolvedValue(undefined);
    storage.removeItem.mockResolvedValue(undefined);
    session = require('../src/config/apiSession');
    ({ clearApiSession, getApiAccessToken, setApiSession } = session);
  });

  it('hydrates once for concurrent callers', async () => {
    storage.getItem.mockResolvedValue(JSON.stringify({ access_token: 'saved' }));
    expect(await Promise.all([getApiAccessToken(), getApiAccessToken()])).toEqual(['saved', 'saved']);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it.each(['{bad', 'null', '[]', '{"access_token":123}', '{"expires_at":"tomorrow"}'])('clears malformed persisted sessions: %s', async stored => {
    storage.getItem.mockResolvedValue(stored);
    expect(await getApiAccessToken()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledTimes(1);
  });

  it('retries failed reads without deleting potentially valid credentials', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('locked')).mockResolvedValue(JSON.stringify({ access_token: 'saved' }));
    await expect(getApiAccessToken()).rejects.toThrow('locked');
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(await getApiAccessToken()).toBe('saved');
  });

  it('surfaces failed persistence and deletion', async () => {
    storage.setItem.mockRejectedValue(new Error('write failed'));
    await expect(setApiSession({ access_token: 'new' })).rejects.toThrow('write failed');
    storage.removeItem.mockRejectedValue(new Error('delete failed'));
    await expect(clearApiSession()).rejects.toThrow('delete failed');
    expect(session.getCachedApiSession()).toBeNull();
  });

  it('does not restore a stale stored account after sign-out during hydration', async () => {
    let finish!: (stored: string) => void;
    storage.getItem.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = getApiAccessToken();
    await clearApiSession();
    finish(JSON.stringify({ access_token: 'stale' }));
    expect(await loading).toBeNull();
  });

  it('does not delete a newly signed-in session when an old read returns corrupt data', async () => {
    let finish!: (stored: string) => void;
    storage.getItem.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = getApiAccessToken();
    await setApiSession({ access_token: 'new' });
    finish('{bad');
    expect(await loading).toBe('new');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('rotates one token for simultaneous API requests', async () => {
    await setApiSession({ access_token: 'old', refresh_token: 'refresh', expires_at: 1 });
    const next = { access_token: 'new', refresh_token: 'rotated', expires_at: Date.now() / 1000 + 3600 };
    (apiClient.post as jest.Mock).mockResolvedValue({ session: next });
    expect(await Promise.all(Array.from({ length: 20 }, () => getApiAccessToken()))).toEqual(Array(20).fill('new'));
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('does not restore an account after sign-out during refresh', async () => {
    await setApiSession({ access_token: 'old', refresh_token: 'refresh', expires_at: 1 });
    let resolve!: (value: unknown) => void;
    (apiClient.post as jest.Mock).mockImplementation(() => new Promise(done => { resolve = done; }));
    const token = getApiAccessToken();
    await new Promise(done => setTimeout(done, 0));
    await clearApiSession();
    resolve({ session: { access_token: 'resurrected' } });
    expect(await token).toBeNull();
    expect(await getApiAccessToken()).toBeNull();
  });

  it('does not return a refreshed token after sign-out during persistence', async () => {
    await setApiSession({ access_token: 'old', refresh_token: 'refresh', expires_at: 1 });
    apiClient.post.mockResolvedValue({ session: { access_token: 'new' } });
    let finish!: () => void;
    let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    storage.setItem.mockImplementation(() => {
      started();
      return new Promise<void>(resolve => { finish = resolve; });
    });
    const loading = getApiAccessToken();
    await writing;
    await clearApiSession();
    finish();
    expect(await loading).toBeNull();
  });

  it('clears sessions rejected by the refresh API', async () => {
    await setApiSession({ access_token: 'old', refresh_token: 'refresh', expires_at: 1 });
    const { ApiClientError } = jest.requireMock('../src/config/apiClient');
    apiClient.post.mockRejectedValue(new ApiClientError('expired', 401));
    await expect(getApiAccessToken()).rejects.toThrow('expired');
    expect(session.getCachedApiSession()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledTimes(1);
  });

  it('does not trust a persisted admin capability before live validation', async () => {
    storage.getItem.mockResolvedValue(JSON.stringify({ access_token: 'saved', user: { id: 'owner', is_admin: true } }));
    expect((await session.getApiSession())?.user?.is_admin).toBe(false);
    apiClient.get.mockResolvedValue({ user: { id: 'owner', is_admin: true, user_metadata: { role: 'client' } } });
    expect((await session.validateApiSession())?.user?.is_admin).toBe(true);
    expect(apiClient.get).toHaveBeenCalledWith('/auth/me', { token: 'saved' });
  });

  it('shares concurrent live validation and applies a removed allowlist capability', async () => {
    await setApiSession({ access_token: 'saved', user: { id: 'owner', is_admin: true } });
    apiClient.get.mockResolvedValue({ user: { id: 'owner', is_admin: false, user_metadata: { role: 'model' } } });
    const results = await Promise.all([session.validateApiSession(), session.validateApiSession()]);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(results.every(result => result?.user?.is_admin === false)).toBe(true);
    expect(session.getCachedApiSession()?.user?.user_metadata?.role).toBe('model');
  });

  it('does not inherit missing capability from cached or metadata admin claims', async () => {
    await setApiSession({ access_token: 'saved', user: { id: 'owner', is_admin: true } });
    apiClient.get.mockResolvedValue({ user: { id: 'owner', user_metadata: { role: 'admin', is_admin: true } } });
    expect((await session.validateApiSession())?.user?.is_admin).toBe(false);
  });

  it('drops cached admin access on validation network failure but retains credentials', async () => {
    await setApiSession({ access_token: 'saved', user: { id: 'owner', is_admin: true } });
    apiClient.get.mockRejectedValue(new Error('offline'));
    await expect(session.validateApiSession()).rejects.toThrow('offline');
    expect(session.getCachedApiSession()?.user?.is_admin).toBe(false);
    expect(await getApiAccessToken()).toBe('saved');
  });

  it('rejects missing or mismatched server identity without retaining admin access', async () => {
    for (const response of [{}, { user: { id: 'other', is_admin: true } }]) {
      await setApiSession({ access_token: 'saved', user: { id: 'owner', is_admin: true } });
      apiClient.get.mockResolvedValue(response);
      await expect(session.validateApiSession()).rejects.toThrow('Unable to validate the current account.');
      expect(session.getCachedApiSession()?.user?.is_admin).toBe(false);
    }
  });

  it('clears credentials when auth/me rejects the token', async () => {
    await setApiSession({ access_token: 'saved', user: { id: 'owner', is_admin: true } });
    const { ApiClientError } = jest.requireMock('../src/config/apiClient');
    apiClient.get.mockRejectedValue(new ApiClientError('expired', 401));
    await expect(session.validateApiSession()).rejects.toThrow('expired');
    expect(session.getCachedApiSession()).toBeNull();
  });

  it('does not restore a signed-out account when a live admin response arrives late', async () => {
    await setApiSession({ access_token: 'saved', user: { id: 'owner', is_admin: true } });
    let finish!: (response: unknown) => void;
    apiClient.get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = session.validateApiSession();
    await new Promise(resolve => setTimeout(resolve, 0));
    await clearApiSession();
    finish({ user: { id: 'owner', is_admin: true } });
    expect(await loading).toBeNull();
    expect(session.getCachedApiSession()).toBeNull();
  });

  it('does not let an old validation overwrite or block a newly signed-in account', async () => {
    await setApiSession({ access_token: 'old', user: { id: 'old-owner', is_admin: true } });
    let finish!: (response: unknown) => void;
    apiClient.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const loading = session.validateApiSession();
    await new Promise(resolve => setTimeout(resolve, 0));
    await setApiSession({ access_token: 'new', user: { id: 'new-user', is_admin: false } });
    apiClient.get.mockResolvedValue({ user: { id: 'new-user', is_admin: false } });
    expect((await session.validateApiSession())?.user?.id).toBe('new-user');
    finish({ user: { id: 'old-owner', is_admin: true } });
    expect(await loading).toBeNull();
    expect(session.getCachedApiSession()?.user?.id).toBe('new-user');
  });

  it('refresh replaces a previously granted capability with the current server result', async () => {
    await setApiSession({ access_token: 'old', refresh_token: 'refresh', expires_at: 1, user: { id: 'owner', is_admin: true } });
    apiClient.post.mockResolvedValue({ session: { access_token: 'new', user: { id: 'owner', is_admin: false } } });
    expect((await session.getApiSession())?.user?.is_admin).toBe(false);
  });
});
