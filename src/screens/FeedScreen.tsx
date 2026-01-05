import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { supabase } from '../config/supabaseClient';
import { Post } from '../types';

type Navigation = StackNavigationProp<RootStackParamList, 'PostDetail'>;
type RpcPost = {
  id: string;
  user_id: string;
  caption: string | null;
  image_url: string | null;
  location: string | null;
  likes: number | null;
  comment_count: number | null;
  created_at: string;
};

const PAGE_SIZE = 10;
const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80&sat=-20';

const FeedScreen: React.FC = () => {
  const { state, toggleLike, refresh } = useAppData();
  const navigation = useNavigation<Navigation>();
  const { width } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [recommendedPosts, setRecommendedPosts] = useState<Post[]>([]);
  const loadingRef = useRef(false);
  const pageRef = useRef(0);

  const cardSpacing = width > 720 ? 18 : 14;
  const imageHeight = useMemo(() => {
    if (width > 900) return 360;
    if (width > 720) return 320;
    if (width > 480) return 260;
    return 220;
  }, [width]);

  const mapRpcPost = useCallback((payload: RpcPost): Post => {
    const imageUri = payload.image_url ?? PLACEHOLDER_IMAGE;
    return {
      id: payload.id,
      userId: payload.user_id ?? 'unknown',
      caption: payload.caption ?? '',
      imageUri,
      createdAt: payload.created_at,
      likes: payload.likes ?? 0,
      liked: false,
      commentCount: payload.comment_count ?? 0,
      location: payload.location ?? undefined,
    };
  }, []);

  const handleLike = useCallback(
    async (postId: string) => {
      const updated = await toggleLike(postId);
      setRecommendedPosts((prev) =>
        prev.map((post) =>
          post.id === postId && updated
            ? { ...post, liked: updated.liked, likes: updated.likes }
            : post
        )
      );
    },
    [toggleLike]
  );

  const loadRecommendations = useCallback(
    async (reset = false) => {
      if (loadingRef.current && !reset) return;
      loadingRef.current = true;
      setLoadingMore(true);
      setRemoteError(null);
      const nextPage = reset ? 0 : pageRef.current;
      if (reset) {
        setHasMore(true);
        pageRef.current = 0;
      }
      const { data, error } = await supabase.rpc('recommend_posts', {
        limit_count: PAGE_SIZE,
        offset_count: nextPage * PAGE_SIZE,
      });

      if (error) {
        setRemoteError(error.message);
        setHasMore(false);
      } else if (data && Array.isArray(data)) {
        const mapped = data.map(mapRpcPost);
        setRecommendedPosts((prev) => {
          const base = reset ? [] : prev;
          const existing = new Set(base.map((p) => p.id));
          const next = mapped.filter((p) => !existing.has(p.id));
          return [...base, ...next];
        });
        setHasMore(mapped.length === PAGE_SIZE);
        pageRef.current = nextPage + 1;
      } else if (reset) {
        setRecommendedPosts([]);
        setHasMore(false);
      }

      setLoadingMore(false);
      loadingRef.current = false;
    },
    [mapRpcPost]
  );

  useEffect(() => {
    loadRecommendations(true);
  }, [loadRecommendations]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    await loadRecommendations(true);
    setRefreshing(false);
  };

  const handleLoadMore = () => {
    if (!hasMore || loadingMore || recommendedPosts.length === 0) return;
    loadRecommendations();
  };

  const data = recommendedPosts.length ? recommendedPosts : state.posts;

  const renderItem = ({ item }: { item: Post }) => (
    <TouchableOpacity
      style={[styles.card, { marginBottom: cardSpacing }]}
      onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
    >
      <Image source={{ uri: item.imageUri }} style={[styles.image, { height: imageHeight }]} />
      <View style={styles.cardContent}>
        <Text style={styles.caption}>{item.caption}</Text>
        {item.location ? <Text style={styles.meta}>{item.location}</Text> : null}
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => handleLike(item.id)}>
            <Text style={styles.action}>{item.liked ? '♥️' : '♡'} {item.likes}</Text>
          </TouchableOpacity>
          <Text style={styles.action}>💬 {item.commentCount}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Social feed</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('CreatePost')}>
          <Text style={styles.buttonText}>New Post</Text>
        </TouchableOpacity>
      </View>
      {remoteError ? <Text style={styles.errorText}>Falling back to local feed: {remoteError}</Text> : null}
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: imageHeight * 0.3 }]}
        ListEmptyComponent={<Text style={styles.empty}>Share your first post.</Text>}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? <Text style={styles.footer}>Loading recommendations...</Text> : !hasMore ? null : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7fb',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  button: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 120,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  image: {
    width: '100%',
    height: 220,
  },
  cardContent: {
    padding: 12,
  },
  caption: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  meta: {
    color: '#6b7280',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  action: {
    fontWeight: '700',
    color: '#111827',
  },
  empty: {
    textAlign: 'center',
    marginTop: 20,
    color: '#475569',
  },
  footer: {
    textAlign: 'center',
    paddingVertical: 12,
    color: '#475569',
    fontWeight: '600',
  },
  errorText: {
    color: '#b45309',
    marginBottom: 8,
    fontWeight: '700',
  },
});

export default FeedScreen;
