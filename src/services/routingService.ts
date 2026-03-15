import { haversineDistanceKm } from '../utils/geo';

type Coordinate = {
  latitude: number;
  longitude: number;
};

export type RouteResponse = {
  coordinates: [number, number][]; // [longitude, latitude]
  distance: number;
  duration: number;
};

/**
 * RoutingService: Fetches real street-level navigation polylines.
 * Uses OSRM (Open Source Routing Machine) public API.
 */
class RoutingService {
  private readonly BASE_URL = 'https://router.project-osrm.org/routed-v1/driving';

  /**
   * Fetches a route between two points following streets.
   */
  async getRoute(start: Coordinate, end: Coordinate): Promise<RouteResponse> {
    try {
      const url = `${this.BASE_URL}/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Routing API failed');
      }

      const data = await response.json();

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('No route found');
      }

      const route = data.routes[0];
      return {
        coordinates: route.geometry.coordinates,
        distance: route.distance / 1000, // convert to km
        duration: route.duration, // in seconds
      };
    } catch (error) {
      console.warn('RoutingService: Failed to fetch street route, falling back to straight line.', error);
      return this.getFallbackRoute(start, end);
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
    };
  }
}

export const routingService = new RoutingService();
