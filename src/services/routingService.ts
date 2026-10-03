import { haversineDistanceKm } from '../utils/geo';
import { environment } from '../config/environment';
import { apiClient } from '../config/apiClient';

type Coordinate = {
  latitude: number;
  longitude: number;
};

export type RouteResponse = {
  coordinates: [number, number][]; // [longitude, latitude]
  distance: number;
  duration: number;
  source: 'osrm' | 'ors' | 'fallback';
  warning?: string;
};

/**
 * RoutingService: Fetches real street-level navigation polylines.
 * Uses self-hostable OSRM by default, or OpenRouteService when configured.
 */
class RoutingService {
  private readonly REQUEST_TIMEOUT_MS = 8000;

  /**
   * Fetches a route between two points following streets.
   */
  async getRoute(start: Coordinate, end: Coordinate): Promise<RouteResponse> {
    if (environment.backendProvider === 'api') {
      return this.getRouteWithFallback(() => apiClient.get<RouteResponse>(`/routing/route?start_lat=${start.latitude}&start_lng=${start.longitude}&end_lat=${end.latitude}&end_lng=${end.longitude}`), start, end);
    }
    const provider = String(environment.routingProvider || 'osrm').toLowerCase();
    if (provider === 'ors') {
      return this.getRouteWithFallback(() => this.getOpenRouteServiceRoute(start, end), start, end);
    }
    return this.getRouteWithFallback(() => this.getOsrmRoute(start, end), start, end);
  }

  private async getRouteWithFallback(fetchRoute: () => Promise<RouteResponse>, start: Coordinate, end: Coordinate): Promise<RouteResponse> {
    try {
      return await fetchRoute();
    } catch (error) {
      console.warn('RoutingService: Road routing unavailable.', error);
      return this.getFallbackRoute(start, end);
    }
  }

  private async getOsrmRoute(start: Coordinate, end: Coordinate): Promise<RouteResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);
    const baseUrl = String(environment.osrmBaseUrl || 'https://router.project-osrm.org').replace(/\/+$/, '');

    try {
      const url = `${baseUrl}/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson&steps=true`;
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
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getOpenRouteServiceRoute(start: Coordinate, end: Coordinate): Promise<RouteResponse> {
    if (!environment.openRouteServiceApiKey) {
      throw new Error('OpenRouteService API key is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: environment.openRouteServiceApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [
            [start.longitude, start.latitude],
            [end.longitude, end.latitude],
          ],
          instructions: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouteService failed with HTTP ${response.status}`);
      }

      const data = await response.json();
      const feature = data?.features?.[0];
      const coordinates = feature?.geometry?.coordinates;
      const summary = feature?.properties?.summary;
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error('OpenRouteService returned invalid geometry');
      }

      return {
        coordinates,
        distance: Number(summary?.distance ?? 0) / 1000,
        duration: Number(summary?.duration ?? 0),
        source: 'ors',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Preserve direct-distance information without inventing a road or ETA.
   */
  private getFallbackRoute(start: Coordinate, end: Coordinate): RouteResponse {
    return {
      coordinates: [],
      distance: haversineDistanceKm(start, end),
      duration: 0,
      source: 'fallback',
      warning: 'Road routing unavailable. Direct distance only; navigation and ETA are unavailable.',
    };
  }
}

export const routingService = new RoutingService();
