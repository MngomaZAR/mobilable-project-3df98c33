export type ProfileSummary = {
  id: string;
  full_name: string | null;
  city: string | null;
  avatar_url: string | null;
};

export type FeedPost = {
  id: string;
  userId: string;
  title: string;
  location?: string;
  createdAt: string;
  imageUrl: string;
  commentCount: number;
  likes: number;
  liked?: boolean;
  profile?: ProfileSummary;
};

type PostRow = {
  id: string;
  user_id: string;
  caption: string | null;
  location: string | null;
  comment_count: number | null;
  created_at: string;
  image_url: string | null;
  likes_count: number | null;
  profiles?: ProfileSummary[] | null;
};

const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80&sat=-20';

export const mapPostRow = (row: PostRow): FeedPost => {
  const imageUrl = row.image_url ?? PLACEHOLDER_IMAGE;
  const profile = row.profiles && row.profiles.length > 0 ? row.profiles[0] : undefined;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.caption ?? 'Untitled post',
    location: row.location ?? profile?.city ?? undefined,
    createdAt: row.created_at,
    imageUrl,
    commentCount: row.comment_count ?? 0,
    likes: row.likes_count ?? 0,
    profile: profile ?? undefined,
  };
};