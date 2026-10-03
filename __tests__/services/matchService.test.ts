import { fetchRecommendedMatches } from '../../src/services/matchService';
import { backendDb } from '../../src/services/backendGateway';

jest.mock('../../src/services/backendGateway', () => ({ backendDb: { from: jest.fn() } }));

const profile = (id: string, overrides = {}) => ({
  id, full_name: id, city: 'Durban', role: 'photographer', age_verified: true,
  kyc_status: 'approved', ...overrides,
});

describe('provider recommendations', () => {
  const select = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const catalog = (providers: any[], profiles: any[], profileError: any = null) => {
    (backendDb.from as jest.Mock).mockImplementation((table: string) => {
      const query: any = { select, order: () => query, limit: async () => ({ data: providers, error: null }),
        in: async () => ({ data: profiles, error: profileError }) };
      select.mockImplementation(() => query);
      return query;
    });
  };

  it('joins explicit profiles and ranks published numeric rates without dollar estimates', async () => {
    catalog([{ id: 'expensive', hourly_rate: '2500' }, { id: 'affordable', hourly_rate: '1200' }],
      [profile('expensive'), profile('affordable')]);
    const result = await fetchRecommendedMatches('Durban', '', 1500);
    expect(result.map(row => row.id)).toEqual(['affordable', 'expensive']);
    expect(result[0].hourly_rate).toBe(1200);
    expect(result[0].location).toContain('Durban');
    expect(select.mock.calls.every(([value]) => !value.includes('('))).toBe(true);
  });

  it('excludes missing, test, unverified and underage profile records', async () => {
    catalog(['missing', 'test', 'unverified', 'underage', 'visible'].map(id => ({ id })),
      [profile('test', { is_test_account: true }), profile('unverified', { kyc_status: 'pending' }),
        profile('underage', { age_verified: false }), profile('visible')]);
    expect((await fetchRecommendedMatches('', '', 0)).map(row => row.id)).toEqual(['visible']);
  });

  it('never presents unjoined providers when the profile request fails', async () => {
    catalog([{ id: 'one' }], [], { message: 'Network unavailable' });
    await expect(fetchRecommendedMatches('', '', 0)).rejects.toEqual({ message: 'Network unavailable' });
    expect(console.warn).toHaveBeenCalled();
  });
});
