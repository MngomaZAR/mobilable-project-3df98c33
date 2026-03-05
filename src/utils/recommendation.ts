import { Photographer, RecommendationScore } from '../types';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

export const distanceKm = (from: Coordinates, to: Coordinates): number => {
  const R = 6371;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const scoreDistance = (km: number) => {
  if (!Number.isFinite(km)) return 0;
  if (km <= 2) return 1;
  if (km <= 5) return 0.8;
  if (km <= 10) return 0.6;
  if (km <= 20) return 0.4;
  return 0.2;
};

const scoreRating = (rating: number) => {
  if (rating >= 4.8) return 1;
  if (rating >= 4.4) return 0.8;
  if (rating >= 4.0) return 0.6;
  if (rating >= 3.5) return 0.4;
  return 0.2;
};

const scoreAvailability = (isAvailable?: boolean) => (isAvailable === false ? 0.2 : 1);

export const scorePhotographer = (user: Coordinates, photographer: Photographer): RecommendationScore => {
  const km = distanceKm(user, { latitude: photographer.latitude, longitude: photographer.longitude });
  const distanceScore = scoreDistance(km);
  const ratingScore = scoreRating(photographer.rating);
  const availabilityScore = scoreAvailability(photographer.isAvailable);
  const responseScore = 0.6;

  const totalScore =
    distanceScore * 0.5 +
    ratingScore * 0.3 +
    availabilityScore * 0.15 +
    responseScore * 0.05;

  return {
    photographerId: photographer.id,
    distanceKm: km,
    ratingScore,
    availabilityScore,
    responseScore,
    totalScore,
  };
};

export const rankPhotographers = (user: Coordinates, photographers: Photographer[]) => {
  const ranked = photographers.map((photographer) => ({
    photographer,
    score: scorePhotographer(user, photographer),
  }));

  return ranked.sort((a, b) => b.score.totalScore - a.score.totalScore);
};
