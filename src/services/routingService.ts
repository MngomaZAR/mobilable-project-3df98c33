import { haversineDistanceKm } from '../utils/geo';

type Coordinate = {
  latitude: number;
  longitude: number;
};

export type RouteResponse = {
  coordinates: [number, number][]; // [longitude, latitude]
  distance: number;
  duration: number;
  source: 'osrm' | 'fallback';
};

/**
 * RoutingService: Fetches real street-level navigation polylines.
 * Uses OSRM (Open Source Routing Machine) public API.
 */
class RoutingService {
  private readonly BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
  private readonly REQUEST_TIMEOUT_MS = 8000;

  /**
   * Fetches a route between two points following streets.
   */
  async getRoute(start: Coordinate, end: Coordinate): Promise<RouteResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);

    try {
      const url = `${this.BASE_URL}/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson&steps=true`;
      
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Routing API failed with HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('No route found');
      }

      const route = data.routes[0];
      const coordinates = route?.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error('Routing API returned invalid geometry');
      }

      return {
        coordinates,
        distance: route.distance / 1000, // convert to km
        duration: route.duration, // in seconds
        source: 'osrm',
      };
    } catch (error) {
      console.warn('RoutingService: Failed to fetch street route, falling back to straight line.', error);
      return this.getFallbackRoute(start, end);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fallback to a simple straight line if the API is down or no route found.
   */
  private getFallbackRoute(start: Coordinate, end: Coordinate): RouteResponse {
    return {
      coordinates: [
        [start.longitude, start.latitude],
        [end.longitude, end.latitude],
      ],
      distance: haversineDistanceKm(start, end),
      duration: (haversineDistanceKm(start, end) / 40) * 3600, // Approx 40km/h
      source: 'fallback',
    };
  }
}

export const routingService = new RoutingService();
