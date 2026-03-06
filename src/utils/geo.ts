export type Coordinates = { latitude: number; longitude: number };

export const DEFAULT_CAPE_TOWN_COORDINATES: Coordinates = {
  latitude: -33.9249,
  longitude: 18.4241,
};

export function validateSouthAfricanLocation(lat: number, lng: number): boolean {
  return lat >= -35 && lat <= -22 && lng >= 16 && lng <= 33;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const haversineDistanceKm = (from: Coordinates, to: Coordinates) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const normalized = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(normalized), Math.sqrt(1 - normalized));

  return earthRadiusKm * c;
};

export const ensureSouthAfricanCoordinates = (
  candidate: Coordinates,
  fallback: Coordinates = DEFAULT_CAPE_TOWN_COORDINATES
): Coordinates => (validateSouthAfricanLocation(candidate.latitude, candidate.longitude) ? candidate : { ...fallback });
