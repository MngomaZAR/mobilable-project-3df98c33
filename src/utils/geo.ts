export type Coordinates = { latitude: number; longitude: number };

export const DEFAULT_CAPE_TOWN_COORDINATES: Coordinates = {
  latitude: -33.9249,
  longitude: 18.4241,
};

export function validateSouthAfricanLocation(lat: number, lng: number): boolean {
  const isInSA = lat >= -35 && lat <= -22 && lng >= 16 && lng <= 33;
  if (!isInSA) {
    throw new Error('Location must be within South Africa');
  }
  return true;
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
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
};
