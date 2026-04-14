import { AppUser, Photographer, Post, ProfileSummary } from '../types';
import { supabase } from '../config/supabaseClient';
import { PLACEHOLDER_AVATAR, PLACEHOLDER_IMAGE } from './constants';
import { resolveUserRole } from './userRole';

type ProfileRow = { 
  role?: AppUser['role']; 
  is_photographer?: boolean | null;
  is_model?: boolean | null;
  is_test_account?: boolean | null;
  gender?: AppUser['gender'];
  verified?: boolean;
  kyc_status?: AppUser['kyc_status'];
  date_of_birth?: string | null;
  age_verified?: boolean | null;
  age_verified_at?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  phone?: string | null;
  push_token?: string | null;
  city?: string | null;
  contact_details?: any;
} | null;

type PhotographerProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  city: string | null;
  bio?: string | null;
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
  tier_id?: string | null;
  equipment?: any | null;
  review_count?: number | null;
  total_bookings?: number | null;
  created_at?: string;
  profiles: PhotographerProfileRow[] | null;
};

type PostRow = {
  id: string;
  author_id: string;
  caption: string | null;
  location: string | null;
  comment_count: number | null;
  created_at: string;
  image_url: string | null;
  likes_count: number | null;
  profiles?: ProfileSummary[] | null;
};

export const mapSupabaseUser = (user: any, fallbackRole: AppUser['role'] = 'client', profile: ProfileRow = null): AppUser => ({
  id: user.id,
  email: user.email ?? 'unknown-user',
  role: resolveUserRole(
    {
      role: (profile?.role as AppUser['role']) ?? fallbackRole,
      is_photographer: Boolean(profile?.is_photographer),
      is_model: Boolean(profile?.is_model),
    },
    fallbackRole
  ),
  is_photographer: Boolean(profile?.is_photographer),
  is_model: Boolean(profile?.is_model),
  is_test_account: Boolean(profile?.is_test_account),
  gender: (profile?.gender as AppUser['gender']) ?? (profile?.contact_details?.gender as AppUser['gender']) ?? null,
  verified: profile?.verified ?? false,
  kyc_status: profile?.kyc_status ?? (user.user_metadata?.kyc_status as AppUser['kyc_status']) ?? null,
  date_of_birth: profile?.date_of_birth ?? null,
  age_verified: Boolean(profile?.age_verified ?? user.user_metadata?.age_verified ?? false),
  age_verified_at: profile?.age_verified_at ?? null,
  full_name: profile?.full_name ?? user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
  avatar_url: profile?.avatar_url ?? user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
  bio: profile?.bio ?? null,
  phone: profile?.phone ?? null,
  push_token: profile?.push_token ?? null,
  city: profile?.city ?? null,
  contact_details: profile?.contact_details ?? {},
});

export const mapPhotographerRow = (row: PhotographerRow): Photographer => {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const fallbackLocation = profile?.city ? `${profile.city}, South Africa` : 'South Africa';
  return {
    id: row.id,
    name: profile?.full_name ?? 'New photographer',
    avatar_url: profile?.avatar_url ?? PLACEHOLDER_AVATAR,
    rating: typeof row.rating === 'number' ? row.rating : 0,
    location: row.location ?? fallbackLocation,
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
    style: row.style ?? '',
    bio: profile?.bio ?? row.bio ?? '', // Prefer profile bio
    price_range: row.price_range ?? 'R1500',
    tags: row.tags ?? [],
    tier_id: row.tier_id ?? null,
    equipment: row.equipment ?? null,
    review_count: typeof row.review_count === 'number' ? row.review_count : 0,
    total_bookings: typeof row.total_bookings === 'number' ? row.total_bookings : 0,
    created_at: row.created_at,
  };
};

export const mapPostRow = (row: PostRow): Post => {
  const imageUrl = row.image_url ?? PLACEHOLDER_IMAGE;
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    author_id: row.author_id,
    caption: row.caption ?? 'Untitled post',
    location: row.location ?? profile?.city ?? undefined,
    created_at: row.created_at,
    image_url: imageUrl,
    comment_count: row.comment_count ?? 0,
    likes_count: row.likes_count ?? 0,
    liked: false, // Default to false, updated by SocialFeed if needed
    profile: profile || undefined,
  };
};
