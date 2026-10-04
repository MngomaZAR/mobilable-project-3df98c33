import { backendDb } from './backendGateway';
import { Model, Photographer, Post } from '../types';
import { mapModelRow, mapPhotographerRow } from '../utils/mappings';
import { resolveStorageRef } from './uploadService';
import { BUCKETS } from '../config/environment';

export type CreatorProfile = {
  id: string;
  role: string;
  full_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  city: string | null;
  verified: boolean;
  kyc_status: string | null;
  age_verified: boolean;
  website: string | null;
  instagram: string | null;
  username: string | null;
};

export type CreatorProfileDetail = { profile: CreatorProfile; talent: Photographer | Model | null };

export const fetchCreatorProfile = async (userId: string): Promise<CreatorProfileDetail | null> => {
  const { data: profile, error } = await backendDb.from('profiles')
    .select('id,role,full_name,bio,avatar_url,city,verified,kyc_status,age_verified,website,instagram,username')
    .eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message || 'Could not load this profile.');
  if (!profile) return null;
  if (!['model', 'photographer'].includes(profile.role)) return { profile, talent: null };
  const table = profile.role === 'model' ? 'models' : 'photographers';
  const { data: row, error: talentError } = await backendDb.from(table).select('*').eq('id', userId).maybeSingle();
  if (talentError) throw new Error(talentError.message || 'Could not load creator details.');
  const mapped = row ? { ...row, profiles: [profile] } : null;
  return { profile, talent: mapped ? (profile.role === 'model' ? mapModelRow(mapped) : mapPhotographerRow(mapped)) : null };
};

export const fetchCreatorPosts = async (userId: string): Promise<Post[]> => {
  const { data, error } = await backendDb.from('posts')
    .select('id,author_id,image_url,caption,created_at,likes_count,comment_count')
    .eq('author_id', userId).order('created_at', { ascending: false }).limit(60);
  if (error) throw new Error(error.message || 'Could not load recent work.');
  return Promise.all((data ?? []).map(async (row: Post) => ({
    ...row, image_url: await resolveStorageRef(row.image_url, BUCKETS.posts),
  })));
};
