import { useEffect, useState } from 'react';
import { routingService } from '../services/routingService';
import { Coordinates, haversineDistanceKm, validateSouthAfricanLocation } from '../utils/geo';

type RoadRoute = {
  key: string;
  status: 'loading' | 'ready' | 'unavailable' | 'idle';
  coordinates: [number, number][];
  distanceKm: number | null;
  durationSec: number | null;
};
const EMPTY_COORDINATES: [number, number][] = [];
const emptyRoute = (key: string, status: RoadRoute['status']): RoadRoute => ({
  key, status, coordinates: EMPTY_COORDINATES, distanceKm: null, durationSec: null,
});

export function useRoadRoute(start: Coordinates | null, end: Coordinates | null) {
  const startLat = start?.latitude;
  const startLng = start?.longitude;
  const endLat = end?.latitude;
  const endLng = end?.longitude;
  const [attempt, setAttempt] = useState(0);
  const key = `${startLat},${startLng}:${endLat},${endLng}:${attempt}`;
  const [result, setResult] = useState<RoadRoute | null>(null);
  const valid = startLat !== undefined && startLng !== undefined && endLat !== undefined && endLng !== undefined &&
    validateSouthAfricanLocation(startLat, startLng) && validateSouthAfricanLocation(endLat, endLng);

  useEffect(() => {
    if (!valid) return;
    let active = true;
    const from = { latitude: startLat!, longitude: startLng! };
    const to = { latitude: endLat!, longitude: endLng! };
    setResult(emptyRoute(key, 'loading'));
    void routingService.getRoute(from, to).then(route => {
      if (!active) return;
      const points = route.coordinates;
      const geometryValid = Array.isArray(points) && points.length >= 2 && points.every(point =>
        Array.isArray(point) && point.length >= 2 &&
        Number.isFinite(point[0]) && Number.isFinite(point[1]) && validateSouthAfricanLocation(point[1], point[0]));
      if (!['osrm', 'ors'].includes(route.source) || !geometryValid || !Number.isFinite(route.distance) || route.distance < 0 ||
          !Number.isFinite(route.duration) || route.duration <= 0 ||
          haversineDistanceKm(from, { latitude: points[0][1], longitude: points[0][0] }) > 1 ||
          haversineDistanceKm(to, { latitude: points[points.length - 1][1], longitude: points[points.length - 1][0] }) > 1) {
        setResult(emptyRoute(key, 'unavailable'));
        return;
      }
      setResult({ key, status: 'ready', coordinates: points, distanceKm: route.distance, durationSec: route.duration });
    }).catch(() => { if (active) setResult(emptyRoute(key, 'unavailable')); });
    return () => { active = false; };
  }, [valid, key, startLat, startLng, endLat, endLng]);

  // Hide previous geometry immediately, even before the new effect runs.
  const route = valid ? (result?.key === key ? result : emptyRoute(key, 'loading')) : emptyRoute(key, 'idle');
  return { ...route, retry: () => setAttempt(value => value + 1) };
}
