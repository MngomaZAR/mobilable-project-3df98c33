import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../config/supabaseClient';
import { useAppData } from '../store/AppDataContext';

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

type SocialFeedProps = {
  onCreatePost?: () => void;
  onViewPost?: (post: FeedPost) => void;
  onViewProfile?: (profileId: string) => void;
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
  profiles?: ProfileSummary | ProfileSummary[] | null;
};

const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80&sat=-20';
const TEST_POST_TITLES = new Set(['qa testing', 'test post', 'demo post']);

export const SocialFeed: React.FC<SocialFeedProps> = ({ onCreatePost, onViewPost, onViewProfile }) => {
  const { currentUser } = useAppData();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapPostRow = useCallback((row: PostRow): FeedPost => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const imageUrl = row.image_url ?? PLACEHOLDER_IMAGE;
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
  }, []);

  const getSignedImageUrl = useCallback(async (imageUrl: string) => {
    if (!imageUrl) return imageUrl;
    const isHttp = imageUrl.startsWith('http');
    if (!isHttp) {
      const { data, error } = await supabase.storage.from('post-images').createSignedUrl(imageUrl, 60 * 60);
      if (error || !data?.signedUrl) return imageUrl;
      return data.signedUrl;
    }
    if (!imageUrl.includes('/storage/v1/object/')) return imageUrl;
    const match = imageUrl.match(/\/storage\/v1\/object\/public\/post-images\/(.+)$/);
    if (!match) return imageUrl;
    const path = match[1];
    const { data, error } = await supabase.storage.from('post-images').createSignedUrl(path, 60 * 60);
    if (error || !data?.signedUrl) return imageUrl;
    return data.signedUrl;
  }, []);

  const fetchPosts = useCallback(async () => {
    const { data, error: postError } = await supabase
      .from('posts')
      .select(
        `
        id,
        user_id,
        caption,
        location,
        comment_count,
        created_at,
        image_url,
        likes_count,
        profiles:profiles!posts_user_id_fkey(id, full_name, city, avatar_url)
      `
      )
      .order('created_at', { ascending: false });

    if (postError) {
      throw new Error(postError.message);
    }

    const mapped = (data ?? [])
      .map(mapPostRow)
      .filter((post) => !TEST_POST_TITLES.has(post.title.trim().toLowerCase()));
    const withSignedUrls = await Promise.all(
      mapped.map(async (post) => ({
        ...post,
        imageUrl: await getSignedImageUrl(post.imageUrl),
      }))
    );
    if (currentUser?.id) {
      const { data: likesData } = await supabase
        .from('post_likes')
        .select('post_id')
        .in(
          'post_id',
          withSignedUrls.map((post) => post.id)
        )
        .eq('user_id', currentUser.id);
      const likedSet = new Set((likesData ?? []).map((row: any) => row.post_id));
      setPosts(withSignedUrls.map((post) => ({ ...post, liked: likedSet.has(post.id) })));
    } else {
      setPosts(withSignedUrls);
    }
  }, [currentUser?.id, getSignedImageUrl, mapPostRow]);

  const loadFeed = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      await fetchPosts();
    } catch (err: any) {
      setError(err.message ?? 'Unable to load the feed right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchPosts]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  useFocusEffect(
    useCallback(() => {
      loadFeed();
    }, [loadFeed])
  );

  const fetchPostById = useCallback(
    async (postId: string) => {
      const { data, error: postError } = await supabase
        .from('posts')
        .select(
          `
          id,
          user_id,
          caption,
          location,
          comment_count,
          created_at,
          image_url,
          likes_count,
          profiles:profiles!posts_user_id_fkey(id, full_name, city, avatar_url)
        `
        )
        .eq('id', postId)
        .maybeSingle();

      if (postError) {
        console.warn('Post hydrate failed', postError);
        return null;
      }

      if (!data) return null;
      const mapped = mapPostRow(data as PostRow);
      return {
        ...mapped,
        imageUrl: await getSignedImageUrl(mapped.imageUrl),
      };
    },
    [getSignedImageUrl, mapPostRow]
  );

  useEffect(() => {
    const channel = supabase
      .channel('public:posts-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, async (payload) => {
        if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as any)?.id;
          if (!deletedId) return;
          setPosts((prev) => prev.filter((post) => post.id !== deletedId));
          return;
        }

        const targetId = (payload.new as any)?.id ?? (payload.old as any)?.id;
        if (!targetId) return;
        const hydrated = await fetchPostById(targetId);
        if (!hydrated) return;

        setPosts((prev) => {
          const exists = prev.some((post) => post.id === hydrated.id);
          const next = exists
            ? prev.map((post) => (post.id === hydrated.id ? hydrated : post))
            : [hydrated, ...prev];
          return next.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        });
      });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPostById]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFeed();
  };

  const renderHeader = () => (
    <View style={styles.listHeader}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Social feed</Text>
          <Text style={styles.subtitle}>See what the community is sharing.</Text>
        </View>
        <TouchableOpacity
          style={[styles.primaryButton, !onCreatePost && styles.primaryButtonDisabled]}
          onPress={onCreatePost}
          disabled={!onCreatePost}
        >
          <Text style={styles.primaryButtonText}>New Post</Text>
        </TouchableOpacity>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );

  const renderItem = ({ item }: { item: FeedPost }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <TouchableOpacity
          style={styles.authorRow}
          onPress={() => onViewProfile?.(item.userId)}
        >
          <Image
            source={{ uri: item.profile?.avatar_url ?? PLACEHOLDER_IMAGE }}
            style={styles.avatar}
          />
          <View style={styles.authorText}>
            <Text style={styles.authorName}>{item.profile?.full_name ?? 'Demo photographer'}</Text>
            <Text style={styles.authorMeta}>{item.location ?? item.profile?.city ?? 'Latest post'}</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.timestamp}>{new Date(item.createdAt).toLocaleDateString()}</Text>
      </View>

      <TouchableOpacity activeOpacity={0.9} onPress={() => onViewPost?.(item)}>
        <Image source={{ uri: item.imageUrl }} style={styles.image} />
      </TouchableOpacity>

      <View style={styles.cardBody}>
        <Text style={styles.postTitle}>{item.title}</Text>
        {item.location ? <Text style={styles.postMeta}>{item.location}</Text> : null}
        <View style={styles.actionRow}>
          <Text style={styles.actionStat}>💬 {item.commentCount}</Text>
          <Text style={styles.actionStat}>❤ {item.likes}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading && !refreshing ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#0f172a" />
          <Text style={styles.loadingText}>Loading the social feed...</Text>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={!loading ? <Text style={styles.empty}>You're caught up for now.</Text> : null}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7fb',
  },
  listContent: {
    padding: 16,
    paddingBottom: 80,
  },
  listHeader: {
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    color: '#475569',
    marginTop: 4,
    maxWidth: 240,
  },
  primaryButton: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authorText: {
    marginLeft: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#e5e7eb',
  },
  authorName: {
    fontWeight: '700',
    color: '#0f172a',
  },
  authorMeta: {
    color: '#6b7280',
  },
  timestamp: {
    color: '#6b7280',
    fontSize: 12,
  },
  image: {
    width: '100%',
    height: 240,
  },
  cardBody: {
    padding: 12,
  },
  postTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  postMeta: {
    color: '#6b7280',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  actionStat: {
    fontWeight: '700',
    color: '#111827',
  },
  empty: {
    textAlign: 'center',
    color: '#475569',
    paddingVertical: 20,
    fontWeight: '600',
  },
  errorText: {
    color: '#b45309',
    fontWeight: '700',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#475569',
    fontWeight: '600',
    marginTop: 10,
  },
  separator: {
    height: 14,
  },
});

export default SocialFeed;
