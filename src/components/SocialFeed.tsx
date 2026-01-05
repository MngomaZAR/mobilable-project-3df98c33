import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../config/supabaseClient';

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
  profiles?: ProfileSummary | null;
};

const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80&sat=-20';

export const SocialFeed: React.FC<SocialFeedProps> = ({ onCreatePost, onViewPost, onViewProfile }) => {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapPostRow = useCallback((row: PostRow): FeedPost => {
    const imageUrl = row.image_url ?? PLACEHOLDER_IMAGE;
    return {
      id: row.id,
      userId: row.user_id,
      title: row.caption ?? 'Untitled post',
      location: row.location ?? row.profiles?.city ?? undefined,
      createdAt: row.created_at,
      imageUrl,
      commentCount: row.comment_count ?? 0,
      likes: row.likes_count ?? 0,
      profile: row.profiles ?? undefined,
    };
  }, []);

  const fetchProfiles = useCallback(async () => {
    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, city, avatar_url')
      .order('full_name', { ascending: true });

    if (profileError) {
      const message =
        (profileError as any)?.code === '42P01'
          ? 'profiles table is missing. Apply the latest Supabase migration.'
          : profileError.message;
      throw new Error(message);
    }
    setProfiles(data ?? []);
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
        profiles:profiles(id, full_name, city, avatar_url)
      `
      )
      .order('created_at', { ascending: false });

    if (postError) {
      throw new Error(postError.message);
    }

    const mapped = (data ?? []).map(mapPostRow);
    setPosts(mapped);
  }, [mapPostRow]);

  const loadFeed = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      await Promise.all([fetchProfiles(), fetchPosts()]);
    } catch (err: any) {
      setError(err.message ?? 'Unable to load the feed right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchPosts, fetchProfiles]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

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
          profiles:profiles(id, full_name, city, avatar_url)
        `
        )
        .eq('id', postId)
        .maybeSingle();

      if (postError) {
        console.warn('Post hydrate failed', postError);
        return null;
      }

      return data ? mapPostRow(data as PostRow) : null;
    },
    [mapPostRow]
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

  const filteredPosts = useMemo(() => {
    if (!selectedProfileId) return posts;
    return posts.filter((post) => post.userId === selectedProfileId);
  }, [posts, selectedProfileId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFeed();
  };

  const renderHeader = () => (
    <View style={styles.listHeader}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Social feed</Text>
          <Text style={styles.subtitle}>Live Supabase posts from every demo profile.</Text>
        </View>
        <TouchableOpacity
          style={[styles.primaryButton, !onCreatePost && styles.primaryButtonDisabled]}
          onPress={onCreatePost}
          disabled={!onCreatePost}
        >
          <Text style={styles.primaryButtonText}>New Post</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.helper}>Filter the feed by creator to scan the latest posts.</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.profileRail}
      >
        <TouchableOpacity
          style={[styles.profileChip, !selectedProfileId && styles.profileChipActive]}
          onPress={() => setSelectedProfileId(null)}
        >
          <Image source={{ uri: PLACEHOLDER_IMAGE }} style={styles.profileAvatar} />
          <View style={styles.profileText}>
            <Text style={styles.profileName}>All profiles</Text>
            <Text style={styles.profileMeta}>{posts.length} posts</Text>
          </View>
        </TouchableOpacity>
        {profiles.map((profile, index) => (
          <TouchableOpacity
            key={profile.id}
            style={[
              styles.profileChip,
              selectedProfileId === profile.id && styles.profileChipActive,
              index === profiles.length - 1 ? null : styles.profileChipSpacer,
            ]}
            onPress={() => setSelectedProfileId(profile.id)}
          >
            <Image source={{ uri: profile.avatar_url ?? PLACEHOLDER_IMAGE }} style={styles.profileAvatar} />
            <View style={styles.profileText}>
              <Text style={styles.profileName}>{profile.full_name ?? 'Demo profile'}</Text>
              <Text style={styles.profileMeta}>{profile.city ?? 'South Africa'}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
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
          data={filteredPosts}
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
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    color: '#475569',
    marginTop: 4,
    maxWidth: 280,
  },
  helper: {
    color: '#6b7280',
  },
  primaryButton: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  profileRail: {
    paddingVertical: 4,
  },
  profileChipSpacer: {
    marginRight: 12,
  },
  profileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  profileText: {
    marginLeft: 10,
  },
  profileChipActive: {
    borderColor: '#0f172a',
    backgroundColor: '#0f172a08',
  },
  profileAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#e5e7eb',
  },
  profileName: {
    fontWeight: '700',
    color: '#0f172a',
  },
  profileMeta: {
    color: '#6b7280',
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
