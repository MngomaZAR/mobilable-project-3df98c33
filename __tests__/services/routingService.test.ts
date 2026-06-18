import { routingService } from '../../src/services/routingService';

describe('routingService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('requests OSRM road geometry and returns route metadata', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            geometry: {
              coordinates: [
                [18.4241, -33.9249],
                [18.4252, -33.9238],
                [18.4265, -33.9227],
              ],
            },
            distance: 2400,
            duration: 420,
          },
        ],
      }),
    }) as jest.Mock;

    const route = await routingService.getRoute(
      { latitude: -33.9249, longitude: 18.4241 },
      { latitude: -33.9227, longitude: 18.4265 }
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://router.project-osrm.org/route/v1/driving/18.4241,-33.9249;18.4265,-33.9227'),
      expect.objectContaining({ signal: expect.any(Object) })
    );
    expect(route).toMatchObject({
      distance: 2.4,
      duration: 420,
      source: 'osrm',
    });
    expect(route.coordinates).toHaveLength(3);
  });

  it('marks direct routes as fallback when OSRM is unavailable', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as jest.Mock;

    const route = await routingService.getRoute(
      { latitude: -33.9249, longitude: 18.4241 },
      { latitude: -33.9227, longitude: 18.4265 }
    );

    expect(route.source).toBe('fallback');
    expect(route.coordinates).toEqual([
      [18.4241, -33.9249],
      [18.4265, -33.9227],
    ]);
  });
});
