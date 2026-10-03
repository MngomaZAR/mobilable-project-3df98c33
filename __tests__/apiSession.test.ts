jest.mock('../src/config/apiClient', () => ({
  apiClient: { post: jest.fn() },
  ApiClientError: class extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } },
}));

jest.mock('../src/services/sessionStorage', () => ({
  sessionStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

describe('API session persistence and refresh', () => {
  let apiClient: { post: jest.Mock };
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
});
