import { AppUser, Photographer } from '../types';

type ProfileRow = { role?: AppUser['role']; verified?: boolean } | null;

type PhotographerProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  city: string | null;
} | null;

type PhotographerRow = {
  id: string;
  rating: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  price_range: string | null;
  style: string | null;
  bio: string | null;
  tags: string[] | null;
  profiles: PhotographerProfileRow[] | null;
};

const FALLBACK_AVATAR = 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=300&q=80';

export const mapSupabaseUser = (user: any, fallbackRole: AppUser['role'] = 'client', profile: ProfileRow = null): AppUser => ({
  id: user.id,
  email: user.email ?? 'unknown-user',
  role: (profile?.role as AppUser['role']) ?? fallbackRole,
  verified: profile?.verified ?? false,
});

export const mapPhotographerRow = (row: PhotographerRow): Photographer => {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const fallbackLocation = profile?.city ? `${profile.city}, South Africa` : 'South Africa';
  return {
    id: row.id,
    name: profile?.full_name ?? 'New photographer',
    avatar: profile?.avatar_url ?? FALLBACK_AVATAR,
    rating: typeof row.rating === 'number' ? row.rating : 0,
    location: row.location ?? fallbackLocation,
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
    style: row.style ?? '',
    bio: row.bio ?? '',
    priceRange: row.price_range ?? 'R1500',
    tags: row.tags ?? [],
  };
};