export type Coordinates = { latitude: number; longitude: number };

export const DEFAULT_CAPE_TOWN_COORDINATES: Coordinates = {
  latitude: -33.9249,
  longitude: 18.4241,
};

// Launch city. Used as the map's starting point when we have neither a GPS fix nor a profile city.
export const DEFAULT_LAUNCH_COORDINATES: Coordinates = { latitude: -29.8587, longitude: 31.0218 }; // Durban

const CITY_CENTERS: Record<string, Coordinates> = {
  durban: { latitude: -29.8587, longitude: 31.0218 },
  pietermaritzburg: { latitude: -29.6006, longitude: 30.3794 },
  'port shepstone': { latitude: -30.7413, longitude: 30.4549 },
  kokstad: { latitude: -30.5472, longitude: 29.4244 },
  johannesburg: { latitude: -26.2041, longitude: 28.0473 },
  pretoria: { latitude: -25.7479, longitude: 28.2293 },
  'cape town': { latitude: -33.9249, longitude: 18.4241 },
  gqeberha: { latitude: -33.9608, longitude: 25.6022 },
  'port elizabeth': { latitude: -33.9608, longitude: 25.6022 },
  'east london': { latitude: -33.0153, longitude: 27.9116 },
  bloemfontein: { latitude: -29.0852, longitude: 26.1596 },
};

/** Centre point for a known South African city name, or null when we do not recognise it. */
export function cityCenter(city?: string | null): Coordinates | null {
  const key = (city ?? '').trim().toLowerCase();
  if (!key) return null;
  if (CITY_CENTERS[key]) return CITY_CENTERS[key];
  const hit = Object.keys(CITY_CENTERS).find((name) => key.includes(name));
  return hit ? CITY_CENTERS[hit] : null;
}

export function validateSouthAfricanLocation(lat: number, lng: number): boolean {
  return lat >= -35 && lat <= -22 && lng >= 16 && lng <= 33;
}

/**
 * Assertion for safety-critical location boundaries.
 * Throws an explicit error if the project's operational domain (South Africa) is breached.
 */
export function assertSouthAfricanLocation(lat: number, lng: number): void {
  if (!validateSouthAfricanLocation(lat, lng)) {
    throw new Error(`Location Out of Bounds: (${lat}, ${lng}) is outside the South African operational zone.`);
  }
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
