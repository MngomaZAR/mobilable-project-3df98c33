import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BlurView } from 'expo-blur';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { AnimatedHeart } from './AnimatedHeart';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { FeedSkeleton } from '../components/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import { Post } from '../types';
import { Story, StoryViewer } from './StoryViewer';
import { HashtagText } from './HashtagText';

type SocialFeedProps = {
  onCreatePost?: () => void;
  onViewPost?: (post: Post) => void;
  onViewProfile?: (profileId: string) => void;
};

const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80&sat=-20';
const PAGE_SIZE = 10;
const WEB_PROFILE_PAGE_SIZE = 24;
const WEB_VISIBLE_FEED_ITEMS = 40;

export const SocialFeed: React.FC<SocialFeedProps> = ({ onCreatePost, onViewPost, onViewProfile }) => {
  const isWeb = Platform.OS === 'web';
  const { state: appState, toggleLike, fetchPosts, fetchProfiles } = useAppData();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [likedAnimPostId, setLikedAnimPostId] = useState<string | null>(null);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [followingOnly, setFollowingOnly] = useState(false);

  const lastTapRef = useRef<number | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [reportedPostIds, setReportedPostIds] = useState<Set<string>>(new Set());

  // --- STORIES ---
  const [storiesVisible, setStoriesVisible] = useState(false);
  const [storyIndex, setStoryIndex] = useState(0);

  // Mocked stories for MVP presentation
  const mockStories: Story[] = useMemo(() => {
     if (appState.photographers.length < 2) return [];
     
     return [
        {
          id: 'story-1',
          user_id: appState.photographers[0].id,
          media_url: 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?auto=format&fit=crop&w=800&q=80',
          media_type: 'image',
          created_at: new Date().toISOString(),
          duration: 5,
          profile: {
             full_name: appState.photographers[0].name,
             avatar_url: appState.photographers[0].avatar_url
          }
        },
        {
          id: 'story-2',
          user_id: appState.photographers[1].id,
          media_url: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=800&q=80',
          media_type: 'image',
          created_at: new Date().toISOString(),
          duration: 5,
          profile: {
             full_name: appState.photographers[1].name,
             avatar_url: appState.photographers[1].avatar_url
          }
        }
     ]
  }, [appState.photographers]);

  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Root'>>();

  const visibleProfiles = useMemo(
    () => (isWeb ? appState.profiles.slice(0, WEB_PROFILE_PAGE_SIZE) : appState.profiles),
    [isWeb, appState.profiles]
  );

  const handleToggleLike = async (postId: string) => {
    try {
      if (!isWeb) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        setLikedAnimPostId(postId);
        setTimeout(() => setLikedAnimPostId(null), 700);
      }
      await toggleLike(postId);
    } catch (err) { }
  };

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchProfiles(), fetchPosts({ reset: true })]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchPosts, fetchProfiles]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const filteredPosts = useMemo(() => {
    let filtered = appState.posts.filter((post) => !blockedUserIds.has(post.user_id) && !reportedPostIds.has(post.id));
    if (selectedProfileId) {
        filtered = filtered.filter((post) => post.user_id === selectedProfileId);
    } else if (followingOnly && appState.currentUser) {
        const followings = new Set((appState.follows || []).map(f => f.following_id));
        filtered = filtered.filter(post => followings.has(post.user_id));
    }
    return filtered;
  }, [appState.posts, selectedProfileId, blockedUserIds, reportedPostIds, followingOnly, appState.currentUser, appState.follows]);

  const visiblePosts = useMemo(
    () => (isWeb ? filteredPosts.slice(0, WEB_VISIBLE_FEED_ITEMS) : filteredPosts),
    [filteredPosts, isWeb]
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFeed();
  };

  const loadMore = async () => {
    if (isWeb || !hasMore || loadingMore || loadMoreInFlightRef.current) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    try {
      await fetchPosts({ reset: false });
      if (appState.posts.length % PAGE_SIZE !== 0) setHasMore(false);
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  };

  const handlePostOptions = (post: Post) => {
    const doReport = () => setReportedPostIds((prev) => new Set([...prev, post.id]));
    const doBlock = () => setBlockedUserIds((prev) => new Set([...prev, post.user_id]));
    
    if (Platform.OS === 'web') {
      if (window.confirm('Report this content?')) doReport();
      return;
    }
    Alert.alert('Content Options', `Action for post by ${post.profile?.full_name ?? 'user'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: '🚩 Report Post', style: 'destructive', onPress: doReport },
      { text: '🚫 Block User', style: 'destructive', onPress: doBlock },
    ]);
  };

  const renderHeader = () => (
    <BlurView 
      intensity={80} 
      tint={isDark ? "dark" : "light"} 
      style={[
        styles.headerContainer, 
        { 
          paddingTop: Math.max(insets.top, 24), 
          backgroundColor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255, 255, 255, 0.65)',
          borderBottomColor: colors.border
        }
      ]}
    >
      <View style={styles.headerInner}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Feed</Text>
        <TouchableOpacity 
          style={[styles.primaryIconButton, { backgroundColor: colors.card, borderColor: colors.border }]} 
          onPress={onCreatePost} 
          disabled={!onCreatePost}
        >
          <Ionicons name="add" size={24} color={colors.accent} />
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.textRail} style={styles.textRailWrapper}>
        <TouchableOpacity 
          style={[
            styles.textChip, 
            { backgroundColor: colors.card, borderColor: colors.border },
            !selectedProfileId && !followingOnly && [styles.textChipActive, { backgroundColor: colors.accent }]
          ]} 
          onPress={() => {
              setSelectedProfileId(null);
              setFollowingOnly(false);
          }}
        >
          <Text style={[
            styles.textChipLabel, 
            { color: colors.textMuted },
            !selectedProfileId && !followingOnly && [styles.textChipLabelActive, { color: colors.card }]
          ]}>All Photographers</Text>
        </TouchableOpacity>
        
        {appState.currentUser && (
            <TouchableOpacity 
              style={[
                styles.textChip, 
                { backgroundColor: colors.card, borderColor: colors.border },
                followingOnly && [styles.textChipActive, { backgroundColor: colors.accent }]
              ]} 
              onPress={() => {
                  setSelectedProfileId(null);
                  setFollowingOnly(true);
              }}
            >
              <Text style={[
                styles.textChipLabel, 
                { color: colors.textMuted },
                followingOnly && [styles.textChipLabelActive, { color: colors.card }]
              ]}>Following</Text>
            </TouchableOpacity>
        )}
        {visibleProfiles.map((p) => (
          <TouchableOpacity 
            key={p.id} 
            style={[
              styles.textChip, 
              { backgroundColor: colors.card, borderColor: colors.border },
              selectedProfileId === p.id && [styles.textChipActive, { backgroundColor: colors.accent }]
            ]} 
            onPress={() => {
                setFollowingOnly(false);
                setSelectedProfileId(p.id);
            }}
          >
            <Text style={[
              styles.textChipLabel, 
              { color: colors.textMuted },
              selectedProfileId === p.id && [styles.textChipLabelActive, { color: colors.card }]
            ]}>{p.full_name ?? 'User'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {appState.error && <Text style={[styles.errorText, { color: colors.destructive }]}>{appState.error}</Text>}
      
      {mockStories.length > 0 && (
         <View style={{ marginTop: 16 }}>
           <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
             {appState.currentUser && (
                <TouchableOpacity style={styles.storyAvatarWrap} onPress={() => Alert.alert('Add Story', 'Not implemented yet.')}>
                   <Image source={{ uri: appState.profiles.find(p => p.id === appState.currentUser?.id)?.avatar_url || PLACEHOLDER_IMAGE }} style={styles.storyAvatar} />
                   <View style={styles.addStoryPlus}>
                       <Ionicons name="add" size={14} color="#fff" />
                   </View>
                </TouchableOpacity>
             )}
             
             {Object.values(
                mockStories.reduce((acc, story) => {
                   if (!acc[story.user_id]) acc[story.user_id] = story;
                   return acc;
                }, {} as Record<string, Story>)
             ).map((story) => (
                 <TouchableOpacity 
                   key={`story-thumb-${story.id}`} 
                   style={[styles.storyAvatarWrap, styles.storyAvatarWrapActive]}
                   onPress={() => {
                        const idx = mockStories.findIndex(s => s.user_id === story.user_id);
                        setStoryIndex(idx);
                        setStoriesVisible(true);
                   }}
                 >
                    <Image source={{ uri: story.profile?.avatar_url || PLACEHOLDER_IMAGE }} style={styles.storyAvatar} />
                 </TouchableOpacity>
             ))}
           </ScrollView>
         </View>
      )}
    </BlurView>
  );

  const renderItem = ({ item }: { item: Post }) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <TouchableOpacity style={styles.authorRow} onPress={() => onViewProfile?.(item.user_id)}>
          <Image source={{ uri: item.profile?.avatar_url ?? PLACEHOLDER_IMAGE }} style={styles.avatar} />
          <View style={styles.authorText}>
            <Text style={[styles.authorName, { color: colors.text }]}>{item.profile?.full_name ?? 'Photographer'}</Text>
            {item.location ? <Text style={[styles.authorMeta, { color: colors.textMuted }]}>{item.location}</Text> : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handlePostOptions(item)}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity activeOpacity={0.9} onPress={() => {
          const now = Date.now();
          if (lastTapRef.current && now - lastTapRef.current < 300) {
            handleToggleLike(item.id);
            lastTapRef.current = null;
          } else {
            lastTapRef.current = now;
            setLightboxUri(item.image_url);
          }
      }}>
        <View style={styles.imageWrapper}>
          <Image source={{ uri: item.image_url }} style={styles.image} />
          {!isWeb && <AnimatedHeart visible={likedAnimPostId === item.id} />}
        </View>
      </TouchableOpacity>

      <View style={styles.interactionBar}>
        <View style={styles.leftActions}>
          <TouchableOpacity onPress={() => handleToggleLike(item.id)} style={styles.iconAction}>
            <Ionicons 
              name={item.liked ? 'heart' : 'heart-outline'} 
              size={26} 
              color={item.liked ? colors.destructive : colors.text} 
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onViewPost?.(item)} style={styles.iconAction}>
            <Ionicons name="chatbubble-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.cardBody}>
        {item.likes_count > 0 && <Text style={[styles.likesCount, { color: colors.text }]}>{item.likes_count} likes</Text>}
        <View style={styles.captionRow}>
          <Text style={[styles.captionName, { color: colors.text }]}>{item.profile?.full_name ?? 'Photographer'}</Text>
          <HashtagText 
            text={` ${item.caption}`} 
            style={[styles.captionText, { color: colors.textSecondary }]}
            onHashtagPress={(tag) => Alert.alert('Hashtag', `Discovery for ${tag} coming soon!`)}
          />
        </View>
        <Text style={[styles.timestampBottom, { color: colors.textMuted }]}>{new Date(item.created_at).toLocaleDateString()}</Text>
      </View>
    </View>
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={{ paddingVertical: 20 }}>
        <ActivityIndicator size="small" />
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="images-outline" size={48} color={colors.textMuted} />
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>No posts yet.</Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {lightboxUri && (
        <View style={styles.lightboxOverlay}>
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightboxUri(null)}><Text style={styles.lightboxCloseText}>Close</Text></TouchableOpacity>
          <Image source={{ uri: lightboxUri }} style={styles.lightboxImage} />
        </View>
      )}
      {loading && !refreshing ? <FeedSkeleton /> : (
        <FlatList
          data={visiblePosts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
        />
      )}
      
      <StoryViewer 
        stories={mockStories} 
        visible={storiesVisible} 
        onClose={() => setStoriesVisible(false)} 
        initialIndex={storyIndex} 
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 80 },
  headerContainer: { paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  headerTitle: { fontSize: 24, fontWeight: '800' },
  primaryIconButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  textRailWrapper: { paddingLeft: 16 },
  textRail: { paddingRight: 32 },
  textChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, borderWidth: 1 },
  textChipActive: { backgroundColor: '#0f172a' },
  textChipLabel: { fontWeight: '600' },
  textChipLabelActive: { color: '#fff' },
  errorText: { padding: 16, textAlign: 'center' },
  card: { borderRadius: 18, marginBottom: 20, overflow: 'hidden', elevation: 4, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  authorRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  authorText: { flex: 1 },
  authorName: { fontWeight: '700' },
  authorMeta: { fontSize: 12 },
  imageWrapper: { width: '100%', aspectRatio: 1 },
  image: { width: '100%', height: '100%' },
  interactionBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  leftActions: { flexDirection: 'row', alignItems: 'center' },
  iconAction: { marginRight: 16 },
  cardBody: { paddingHorizontal: 12, paddingBottom: 16 },
  likesCount: { fontWeight: '700', marginBottom: 4 },
  captionRow: { flexDirection: 'row', flexWrap: 'wrap' },
  captionName: { fontWeight: '700' },
  captionText: { color: '#334155' },
  timestampBottom: { fontSize: 10, marginTop: 8 },
  lightboxOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 1000, justifyContent: 'center', alignItems: 'center' },
  lightboxClose: { position: 'absolute', top: 50, right: 20, padding: 10 },
  lightboxCloseText: { color: '#fff', fontWeight: '700' },
  lightboxImage: { width: '100%', height: '80%', resizeMode: 'contain' },
  emptyContainer: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { marginTop: 16, fontWeight: '600', fontSize: 16 },
  storyAvatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  storyAvatarWrapActive: {
    borderColor: '#e11d48',
  },
  storyAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  addStoryPlus: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    padding: 2,
    borderWidth: 2,
    borderColor: '#fff',
  },
});

export default SocialFeed;
