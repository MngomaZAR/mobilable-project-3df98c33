import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { AnimatedHeart } from './AnimatedHeart';
import { useAppData } from '../store/AppDataContext';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { hasHasura, hasuraGQL } from '../config/hasuraClient';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { initialState } from '../data/initialData';
import { FeedSkeleton } from '../components/Skeleton';
import { LinearGradient } from 'expo-linear-gradient';

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
  profiles?: ProfileSummary[] | null;
};

import { mapPostRow } from '../utils/feedMappings';

const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80&sat=-20';

export const SocialFeed: React.FC<SocialFeedProps> = ({ onCreatePost, onViewPost, onViewProfile }) => {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likedAnimPostId, setLikedAnimPostId] = useState<string | null>(null);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);

  const { toggleLike } = useAppData();
  const lastTapRef = useRef<number | null>(null);
  const paginationOffsetRef = useRef(0);
  const PAGE_SIZE = 10;

  const handleToggleLike = async (postId: string) => {
    try {
      // show a quick heart animation on double-tap
      setLikedAnimPostId(postId);
      setTimeout(() => setLikedAnimPostId(null), 700);

      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, liked: !p.liked, likes: !p.liked ? p.likes + 1 : Math.max(0, p.likes - 1) } : p)));
      await toggleLike(postId);
    } catch (err) {
      setError('Unable to update like.');
    }
  };

  const mapRowToFeedPost = useCallback((row: PostRow): FeedPost => {
    return mapPostRow(row);
  }, []);

  const fetchProfiles = useCallback(async () => {
    // Prefer Hasura if configured
    if (hasHasura) {
      const q = `query Profiles { profiles(order_by: { full_name: asc }) { id full_name city avatar_url } }`;
      const data = await hasuraGQL(q);
      setProfiles(data?.profiles ?? []);
      return;
    }

    if (!hasSupabase) {
      // Use seeded photographers from initialState as profile summaries for local/demo mode
      const mapped = (initialState.photographers ?? []).map((p: any) => ({
        id: p.id,
        full_name: p.name ?? 'Demo profile',
        city: p.location ?? null,
        avatar_url: p.avatar ?? PLACEHOLDER_IMAGE,
      }));
      setProfiles(mapped);
      return;
    }

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

  const fetchPosts = useCallback(async ({ reset = true }: { reset?: boolean } = { reset: true }) => {
    // Hasura GraphQL fetch
    if (hasHasura) {
      const start = reset ? 0 : paginationOffsetRef.current;
      const limit = PAGE_SIZE;
      const q = `query Posts($offset:Int!, $limit:Int!) {
        posts(order_by: { created_at: desc }, offset: $offset, limit: $limit) {
          id
          user_id
          caption
          location
          comment_count
          created_at
          image_url
          likes_count
          profiles { id full_name city avatar_url }
        }
      }`;
      const data = await hasuraGQL(q, { offset: start, limit });
      const items = (data?.posts ?? []).map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        caption: r.caption,
        location: r.location,
        comment_count: r.comment_count,
        created_at: r.created_at,
        image_url: r.image_url,
        likes_count: r.likes_count,
        profiles: r.profiles ? [r.profiles] : undefined,
      }));

      const mapped = (items ?? []).map(mapRowToFeedPost);

      if (reset) {
        setPosts(mapped);
        paginationOffsetRef.current = mapped.length;
      } else {
        setPosts((prev) => [...prev, ...mapped]);
        paginationOffsetRef.current += mapped.length;
      }

      setHasMore((items ?? []).length === PAGE_SIZE);
      return;
    }

    // Fallback to Supabase client if available
    if (!hasSupabase) {
      // Map seeded posts to FeedPost shape for local/demo mode
      const mapped = (initialState.posts ?? []).map((p: any) => ({
        id: p.id,
        userId: p.userId,
        title: p.caption ?? 'Untitled post',
        location: p.location ?? undefined,
        createdAt: p.createdAt,
        imageUrl: p.imageUri ?? PLACEHOLDER_IMAGE,
        commentCount: p.commentCount ?? 0,
        likes: p.likes ?? 0,
        profile: undefined,
      }));

      if (reset) {
        setPosts(mapped);
        paginationOffsetRef.current = mapped.length;
      } else {
        setPosts((prev) => [...prev, ...mapped]);
        paginationOffsetRef.current += mapped.length;
      }
      setHasMore(false);
      return;
    }

    const start = reset ? 0 : paginationOffsetRef.current;
    const end = start + PAGE_SIZE - 1;
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
      .order('created_at', { ascending: false })
      .range(start, end);

    if (postError) {
      throw new Error(postError.message);
    }

    const mapped = (data ?? []).map(mapRowToFeedPost);

    if (reset) {
      setPosts(mapped);
      paginationOffsetRef.current = mapped.length;
    } else {
      setPosts((prev) => [...prev, ...mapped]);
      paginationOffsetRef.current += mapped.length;
    }

    setHasMore((data ?? []).length === PAGE_SIZE);
  }, [mapPostRow]);

  const loadFeed = useCallback(async () => {
    setError(null);
    setLoading(true);
    paginationOffsetRef.current = 0;
    try {
      if (!hasSupabase) {
        setError('Supabase is not configured — showing demo posts. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env to enable live data.');
      }
      await Promise.all([fetchProfiles(), fetchPosts({ reset: true })]);
    } catch (err: any) {
      // If fetching from Supabase fails, fall back to seeded demo posts so the feed remains usable
      const raw = err?.message ?? 'Unable to load the feed right now.';
      const lower = (raw || '').toLowerCase();
      const isNetworkError = /failed to fetch/i.test(raw) || lower.includes('network') || lower.includes('typeerror');
      const message = isNetworkError
        ? 'Network error: unable to reach Supabase. Check EXPO_PUBLIC_SUPABASE_URL, your anon key, and Allowed origins in the Supabase dashboard.'
        : raw;
      setError(message);

      try {
        const mapped = (initialState.posts ?? []).map((p: any) => ({
          id: p.id,
          userId: p.userId,
          title: p.caption ?? 'Untitled post',
          location: p.location ?? undefined,
          createdAt: p.createdAt,
          imageUrl: p.imageUri ?? PLACEHOLDER_IMAGE,
          commentCount: p.commentCount ?? 0,
          likes: p.likes ?? 0,
          profile: undefined,
        }));
        setPosts(mapped);
        paginationOffsetRef.current = mapped.length;
        setHasMore(false);
      } catch (fallbackErr) {
        // ignore fallback errors
      }
    } finally {
      // Ensure the UI always has demo posts when Supabase is unavailable or a fetch failed
      setPosts((prev) => {
        if (prev.length > 0) return prev;
        try {
          const mapped = (initialState.posts ?? []).map((p: any) => ({
            id: p.id,
            userId: p.userId,
            title: p.caption ?? 'Untitled post',
            location: p.location ?? undefined,
            createdAt: p.createdAt,
            imageUrl: p.imageUri ?? PLACEHOLDER_IMAGE,
            commentCount: p.commentCount ?? 0,
            likes: p.likes ?? 0,
            profile: undefined,
          }));
          paginationOffsetRef.current = mapped.length;
          setHasMore(false);
          return mapped;
        } catch (e) {
          return prev;
        }
      });

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

        return data ? mapRowToFeedPost(data as PostRow) : null;
    },
    [mapPostRow]
  );

  useEffect(() => {
    if (!hasSupabase) return;

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

  const lastLoadAtRef = useRef<number | null>(null);

  const loadMore = async () => {
    // prevent duplicate/fast repeat triggers
    if (!hasMore || loadingMore) return;
    if (lastLoadAtRef.current && Date.now() - lastLoadAtRef.current < 800) return;
    setLoadingMore(true);
    lastLoadAtRef.current = Date.now();
    try {
      await fetchPosts({ reset: false });
    } catch (err: any) {
      setError(err.message ?? 'Unable to load more posts.');
    } finally {
      setLoadingMore(false);
    }
  };

  const dismissError = () => setError(null);

  useEffect(() => {
    if (!hasSupabase || !error) return;
    try {
      if (error.toLowerCase().includes('network')) {
        const t = setTimeout(() => setError(null), 12000);
        return () => clearTimeout(t);
      }
    } catch (e) {
      // ignore
    }
  }, [error, hasSupabase]);

  const renderHeader = () => (
    <LinearGradient colors={["#f8fafc", "#eef2ff"]} style={styles.headerContainer}>
      {error && hasSupabase ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText} numberOfLines={2} ellipsizeMode="tail">{error}</Text>
          <TouchableOpacity onPress={dismissError} style={styles.dismissButton}>
            <Text style={styles.dismissText}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.headerInner}>
        <View>
          <Text style={styles.headerTitle}>Social feed</Text>
          <Text style={styles.headerSubtitle}>Browse posts from the community — updated in realtime.</Text>
        </View>
        <TouchableOpacity
          style={[styles.primaryButton, styles.headerCTA, !onCreatePost && styles.primaryButtonDisabled]}
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
        style={styles.profileRailWrapper}
      >
        <TouchableOpacity
          style={[styles.profileChip, !selectedProfileId && styles.profileChipActive]}
          onPress={() => setSelectedProfileId(null)}
        >
          <Image source={{ uri: PLACEHOLDER_IMAGE }} style={styles.profileAvatar} />
          <View style={styles.profileText}>
            <Text style={[styles.profileName, styles.allProfilesName]}>All profiles</Text>
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
    </LinearGradient>
  );

  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Root'>>();
  const { startConversationWithUser } = useAppData();

  const handleMessageUser = async (userId: string, name?: string) => {
    try {
      const convo = await startConversationWithUser(userId, name);
      navigation.navigate('Root', { screen: 'Chat', params: { conversationId: convo.id, title: convo.title } });
    } catch (e) {
      // handled by context
    }
  };

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
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => handleMessageUser(item.userId, item.profile?.full_name ?? undefined)} style={{ marginRight: 10 }}>
            <Text style={{ color: '#0f172a', fontWeight: '700' }}>Message</Text>
          </TouchableOpacity>
          <Text style={styles.timestamp}>{new Date(item.createdAt).toLocaleDateString()}</Text>
        </View>
      </View>

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          const now = Date.now();
          if (lastTapRef.current && now - lastTapRef.current < 300) {
            // double-tap -> like + small animation
            handleToggleLike(item.id);
            setLikedAnimPostId(item.id);
            setTimeout(() => setLikedAnimPostId((id) => (id === item.id ? null : id)), 700);
            lastTapRef.current = null;
            return;
          }
          lastTapRef.current = now;
          // single tap opens lightbox for quick fullscreen preview
          setLightboxUri(item.imageUrl);
        }}
      >
        <View style={styles.imageWrapper}>
          <Image source={{ uri: item.imageUrl }} style={styles.image} />
          <AnimatedHeart visible={likedAnimPostId === item.id} />
        </View>
      </TouchableOpacity>

      <View style={styles.cardBody}>
        <Text style={styles.postTitle} numberOfLines={2} ellipsizeMode="tail">{item.title}</Text>
        {item.location ? <Text style={styles.postMeta}>{item.location}</Text> : null}
        <View style={styles.actionRow}>
          <TouchableOpacity onPress={() => onViewPost?.(item)} style={styles.actionButton}>
            <Text style={styles.actionStat}>💬 {item.commentCount}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleToggleLike(item.id)} style={styles.actionButton}>
            <Text style={styles.actionStat}>{item.liked ? '♥️' : '♡'} {item.likes}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {lightboxUri ? (
        <View style={styles.lightboxOverlay}>
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightboxUri(null)}>
            <Text style={styles.lightboxCloseText}>Close</Text>
          </TouchableOpacity>
          <Image source={{ uri: lightboxUri }} style={styles.lightboxImage} />
          <TouchableOpacity
            style={styles.lightboxOpen}
            onPress={() => {
              const post = (posts ?? []).find((p) => p.imageUrl === lightboxUri);
              setLightboxUri(null);
              if (post) onViewPost?.(post);
            }}
          >
            <Text style={styles.lightboxOpenText}>Open post</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading && !refreshing ? (
        <FeedSkeleton />
      ) : (
        <FlatList
          data={filteredPosts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          stickyHeaderIndices={[0]}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={!loading ? <Text style={styles.empty}>You're caught up for now.</Text> : null}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={loadingMore ? <View style={styles.footer}><ActivityIndicator size="small" /></View> : null}
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
  imageWrapper: {
    position: 'relative',
    backgroundColor: '#e5e7eb',
  },
  image: {
    width: '100%',
    height: 320,
    resizeMode: 'cover',
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
  actionButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
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
  errorBanner: {
    backgroundColor: '#fff7ed',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fde3cf',
  },
  errorBannerText: {
    color: '#9a3412',
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  retryButton: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  dismissButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  dismissText: {
    color: '#6b7280',
    fontWeight: '700',
    fontSize: 18,
    lineHeight: 18,
  },
  infoBanner: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#dbeafe',
  },
  infoBannerText: {
    color: '#1e3a8a',
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  configureButton: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  configureText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
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
  footer: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  likeOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  likeOverlayHeart: {
    fontSize: 72,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  lightboxOverlay: {
    position: 'absolute',
    zIndex: 50,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImage: {
    width: '92%',
    height: '70%',
    resizeMode: 'contain',
    borderRadius: 12,
  },
  lightboxClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    padding: 8,
  },
  lightboxCloseText: {
    color: '#fff',
    fontWeight: '700',
  },
  lightboxOpen: {
    position: 'absolute',
    bottom: 40,
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  lightboxOpenText: {
    color: '#fff',
    fontWeight: '700',
  },
  headerContainer: {
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e6eef8',
  },
  headerInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0f172a',
  },
  headerSubtitle: {
    color: '#475569',
    marginTop: 4,
  },
  headerCTA: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  profileRailWrapper: {
    marginTop: 12,
  },
  allProfilesName: {
    fontWeight: '800',
  },
});

export default SocialFeed;
