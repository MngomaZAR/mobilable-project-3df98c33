import { routingService } from '../../src/services/routingService';
import { environment } from '../../src/config/environment';
import { apiClient } from '../../src/config/apiClient';

describe('routingService', () => {
  const originalFetch = global.fetch;
  const originalBackend = environment.backendProvider;

  beforeEach(() => {
    environment.backendProvider = 'supabase';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    environment.backendProvider = originalBackend;
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

  it('does not draw a straight line or fabricate ETA when routing is unavailable', async () => {
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
    expect(route.coordinates).toEqual([]);
    expect(route.duration).toBe(0);
    expect(route.warning).toContain('unavailable');
  });

  it('uses the Oracle API routing boundary for release builds', async () => {
    environment.backendProvider = 'api';
    const geometry = { coordinates: [[31.03, -29.85], [31.04, -29.87]], distance: 3, duration: 240, source: 'osrm' as const };
    const request = jest.spyOn(apiClient, 'get').mockResolvedValue(geometry);
    await expect(routingService.getRoute({ latitude: -29.85, longitude: 31.03 }, { latitude: -29.87, longitude: 31.04 })).resolves.toEqual(geometry);
    expect(request).toHaveBeenCalledWith('/routing/route?start_lat=-29.85&start_lng=31.03&end_lat=-29.87&end_lng=31.04');
  });

  it('uses OpenRouteService road geometry when configured', async () => {
    const originalProvider = environment.routingProvider;
    const originalKey = environment.openRouteServiceApiKey;
    environment.routingProvider = 'ors';
    environment.openRouteServiceApiKey = 'ors-test-key';

    try {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              geometry: {
                coordinates: [
                  [18.4241, -33.9249],
                  [18.4252, -33.9238],
                  [18.4265, -33.9227],
                ],
              },
              properties: {
                summary: { distance: 3100, duration: 510 },
              },
            },
          ],
        }),
      }) as jest.Mock;

      const route = await routingService.getRoute(
        { latitude: -33.9249, longitude: 18.4241 },
        { latitude: -33.9227, longitude: 18.4265 }
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'ors-test-key' }),
        })
      );
      expect(route).toMatchObject({
        distance: 3.1,
        duration: 510,
        source: 'ors',
      });
    } finally {
      environment.routingProvider = originalProvider;
      environment.openRouteServiceApiKey = originalKey;
    }
  });
});
