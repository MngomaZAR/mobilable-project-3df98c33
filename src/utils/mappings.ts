import { AppUser, Photographer, Post, ProfileSummary } from '../types';
import { supabase } from '../config/supabaseClient';
import { PLACEHOLDER_IMAGE } from './constants';

type ProfileRow = { 
  role?: AppUser['role']; 
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

const FALLBACK_AVATAR = 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=300&q=80';


export const mapSupabaseUser = (user: any, fallbackRole: AppUser['role'] = 'client', profile: ProfileRow = null): AppUser => ({
  id: user.id,
  email: user.email ?? 'unknown-user',
  role: (profile?.role as AppUser['role']) ?? fallbackRole,
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
    avatar_url: profile?.avatar_url ?? FALLBACK_AVATAR,
    rating: typeof row.rating === 'number' ? row.rating : 0,
    location: row.location ?? fallbackLocation,
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
    style: row.style ?? '',
    bio: profile?.bio ?? row.bio ?? '', // Prefer profile bio
    price_range: row.price_range ?? 'R1500',
    tags: row.tags ?? [],
    created_at: row.created_at,
  };
};

export const mapPostRow = (row: PostRow): Post => {
  const imageUrl = row.image_url ?? PLACEHOLDER_IMAGE;
  const profile = Array.isArray(row.profiles) && row.profiles.length > 0 ? row.profiles[0] : (row.profiles as any);
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
