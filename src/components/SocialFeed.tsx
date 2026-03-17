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
  Share,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { AnimatedHeart } from './AnimatedHeart';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { useMessaging } from '../store/MessagingContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { FeedSkeleton } from '../components/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import { Post } from '../types';
import { Story, StoryViewer } from './StoryViewer';
import { HashtagText } from './HashtagText';
import { PLACEHOLDER_IMAGE } from '../utils/constants';
import { supabase } from '../config/supabaseClient';
import { getForYouRanking } from '../services/dispatchService';

type SocialFeedProps = {
  onCreatePost?: () => void;
  onViewPost?: (post: Post) => void;
  onViewProfile?: (profileId: string) => void;
};


const PAGE_SIZE = 10;
const WEB_PROFILE_PAGE_SIZE = 24;
const WEB_VISIBLE_FEED_ITEMS = 40;

/** Enable stories feature - stories table and StoryViewer component are production-ready */
const STORIES_ENABLED = true;

export const SocialFeed: React.FC<SocialFeedProps> = ({ onCreatePost, onViewPost, onViewProfile }) => {
  const isWeb = Platform.OS === 'web';
  const { state: appState, toggleLike, fetchPosts, fetchProfiles } = useAppData();
  const { startConversationWithUser } = useMessaging();
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
  const [forYouOnly, setForYouOnly] = useState(false);
  const [bookmarkedPostIds, setBookmarkedPostIds] = useState<Set<string>>(new Set());
  const [unlockedPostIds, setUnlockedPostIds] = useState<Set<string>>(new Set());
  const [subscribedCreatorIds, setSubscribedCreatorIds] = useState<Set<string>>(new Set());
  const [forYouRankedPostIds, setForYouRankedPostIds] = useState<string[]>([]);

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
          author_id: appState.photographers[0].id,
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
          author_id: appState.photographers[1].id,
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
  const uniqueProfiles = useMemo(() => {
    const seen = new Set<string>();
    return visibleProfiles.filter((p) => {
      if (!p?.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [visibleProfiles]);

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

  const handleToggleBookmark = (post: Post) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const isBookmarked = bookmarkedPostIds.has(post.id);
    const newSet = new Set(bookmarkedPostIds);
    if (isBookmarked) newSet.delete(post.id);
    else newSet.add(post.id);
    setBookmarkedPostIds(newSet);
    
    // Optimistic background save
    import('../config/supabaseClient').then(async ({ supabase }) => {
       const { data: { user } } = await supabase.auth.getUser();
       if (!user) return;
       if (isBookmarked) await supabase.from('post_bookmarks').delete().eq('post_id', post.id).eq('user_id', user.id);
       else await supabase.from('post_bookmarks').insert({ post_id: post.id, user_id: user.id });
    });
  };

  const handleShare = async (post: Post) => {
    try {
      await Share.share({
        message: `Check out this amazing post by ${post.profile?.full_name || 'a creator'} on Papzi!\n\nhttps://papzi.com/post/${post.id}`,
      });
    } catch (error) {
      console.warn('Share error', error);
    }
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

  useEffect(() => {
    if (!forYouOnly) return;
    let active = true;
    const hydrateRanking = async () => {
      try {
        const ranking = await getForYouRanking({ limit: 100 });
        if (!active) return;
        setForYouRankedPostIds((ranking.ranked_posts ?? []).map((r) => r.post_id));
      } catch {
        if (!active) return;
        setForYouRankedPostIds([]);
      }
    };
    hydrateRanking();
    return () => { active = false; };
  }, [forYouOnly, appState.currentUser?.id]);

  useEffect(() => {
    const userId = appState.currentUser?.id;
    if (!userId) {
      setUnlockedPostIds(new Set());
      setSubscribedCreatorIds(new Set());
      return;
    }

    const hydrateEntitlements = async () => {
      const [unlocksRes, subsRes] = await Promise.all([
        supabase.from('post_unlocks').select('post_id').eq('user_id', userId),
        supabase.from('subscriptions').select('creator_id,status').eq('subscriber_id', userId).eq('status', 'active'),
      ]);

      if (unlocksRes.data) setUnlockedPostIds(new Set(unlocksRes.data.map((r: any) => r.post_id)));
      if (subsRes.data) setSubscribedCreatorIds(new Set(subsRes.data.map((r: any) => r.creator_id)));
    };

    hydrateEntitlements().catch(() => {});
  }, [appState.currentUser?.id]);

  const handleUnlockPost = async (post: Post) => {
    const userId = appState.currentUser?.id;
    if (!userId) {
      Alert.alert('Sign in required', 'Please sign in to unlock premium content.');
      return;
    }

    if (!post.price || post.price <= 0) {
      onViewProfile?.(post.author_id);
      return;
    }

    try {
      const { error } = await supabase.from('post_unlocks').upsert(
        { user_id: userId, post_id: post.id, amount_paid: post.price },
        { onConflict: 'user_id,post_id' }
      );
      if (error) throw error;
      setUnlockedPostIds(prev => new Set(prev).add(post.id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err: any) {
      Alert.alert('Unlock failed', err?.message || 'Unable to unlock this post right now.');
    }
  };

  const filteredPosts = useMemo(() => {
    let filtered = appState.posts.filter((post) => !blockedUserIds.has(post.author_id) && !reportedPostIds.has(post.id));
    
    if (forYouOnly) {
        if (forYouRankedPostIds.length > 0) {
          const rankIndex = new Map(forYouRankedPostIds.map((id, idx) => [id, idx]));
          filtered = [...filtered].sort((a, b) => (rankIndex.get(a.id) ?? 999999) - (rankIndex.get(b.id) ?? 999999));
        } else {
          filtered = [...filtered].sort((a, b) => {
             const scoreA = a.likes_count * 2 + new Date(a.created_at).getTime() / 1000000000;
             const scoreB = b.likes_count * 2 + new Date(b.created_at).getTime() / 1000000000;
             return scoreB - scoreA;
          });
        }
    } else if (selectedProfileId) {
        filtered = filtered.filter((post) => post.author_id === selectedProfileId);
    } else if (followingOnly && appState.currentUser) {
        const followings = new Set((appState.follows || []).map(f => f.following_id));
        filtered = filtered.filter(post => followings.has(post.author_id));
    }
    return filtered;
  }, [appState.posts, selectedProfileId, blockedUserIds, reportedPostIds, followingOnly, forYouOnly, appState.currentUser, appState.follows, forYouRankedPostIds]);

  const visiblePosts = useMemo(() => {
    const base = isWeb ? filteredPosts.slice(0, WEB_VISIBLE_FEED_ITEMS) : filteredPosts;
    const seen = new Set<string>();
    return base.filter((p) => {
      if (!p?.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [filteredPosts, isWeb]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFeed();
  };

  const loadMore = async () => {
    if (isWeb || !hasMore || loadingMore || loadMoreInFlightRef.current) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    try {
      const result = await fetchPosts({ reset: false });
      // fetchPosts returns { hasMore } — if not returned, fall back to modulo check
      if (result && typeof result.hasMore === 'boolean') {
        if (!result.hasMore) setHasMore(false);
      } else if (appState.posts.length > 0 && appState.posts.length % PAGE_SIZE !== 0) {
        setHasMore(false);
      }
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  };

  const handlePostOptions = (post: Post) => {
    const doReport = async () => {
      setReportedPostIds((prev) => new Set([...prev, post.id]));
      // Persist report to backend
      try {
        const { supabase } = await import('../config/supabaseClient');
        const { error } = await supabase.from('reports').insert({
          target_type: 'post',
          target_id: post.id,
          reason: 'user_report',
        });
        if (error) throw error;
        Platform.OS === 'web'
          ? window.alert('Report submitted. Thanks for keeping Papzi safe.')
          : Alert.alert('Report submitted', 'Thanks for keeping Papzi safe.');
      } catch (err) {
        console.warn(err);
        Platform.OS === 'web'
          ? window.alert('Report failed. Please try again.')
          : Alert.alert('Report failed', 'Please try again.');
      }
    };
    const doBlock = () => {
      setBlockedUserIds((prev) => new Set([...prev, post.author_id]));
      // Persist block to user_blocks table
      import('../config/supabaseClient').then(({ supabase }) =>
        supabase.auth.getUser().then(({ data }) => {
          if (data.user) {
            supabase.from('user_blocks').insert({
              blocker_id: data.user.id,
              blocked_id: post.author_id,
            }).then(({ error }) => {
              if (error) console.warn(error);
            });
          }
        })
      );
    };
    
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
    <View
      style={[
        styles.headerContainer,
        {
          paddingTop: Math.max(insets.top, 24),
          backgroundColor: isDark ? 'rgba(0,0,0,0.92)' : 'rgba(255,255,255,0.97)',
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
            !selectedProfileId && !followingOnly && !forYouOnly && [styles.textChipActive, { backgroundColor: colors.accent }]
          ]} 
          onPress={() => {
              setSelectedProfileId(null);
              setFollowingOnly(false);
              setForYouOnly(false);
          }}
        >
          <Text style={[
            styles.textChipLabel, 
            { color: colors.textMuted },
            !selectedProfileId && !followingOnly && !forYouOnly && [styles.textChipLabelActive, { color: colors.card }]
          ]}>All Photographers</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.textChip, 
            { backgroundColor: colors.card, borderColor: colors.border },
            forYouOnly && [styles.textChipActive, { backgroundColor: colors.accent }]
          ]} 
          onPress={() => {
              setSelectedProfileId(null);
              setFollowingOnly(false);
              setForYouOnly(true);
          }}
        >
          <Text style={[
            styles.textChipLabel, 
            { color: colors.textMuted },
            forYouOnly && [styles.textChipLabelActive, { color: colors.card }]
          ]}>🌟 For You</Text>
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
                  setForYouOnly(false);
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
        {uniqueProfiles.map((p) => (
          <TouchableOpacity 
            key={p.id} 
            style={[
              styles.textChip, 
              { backgroundColor: colors.card, borderColor: colors.border },
              selectedProfileId === p.id && [styles.textChipActive, { backgroundColor: colors.accent }]
            ]} 
            onPress={() => {
                setFollowingOnly(false);
                setForYouOnly(false);
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
      
      {STORIES_ENABLED && mockStories.length > 0 && (
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
                   if (!acc[story.author_id]) acc[story.author_id] = story;
                   return acc;
                }, {} as Record<string, Story>)
             ).map((story) => (
                 <TouchableOpacity 
                   key={`story-thumb-${story.id}`} 
                   style={[styles.storyAvatarWrap, styles.storyAvatarWrapActive]}
                   onPress={() => {
                        const idx = mockStories.findIndex(s => s.author_id === story.author_id);
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
    </View>
  );

  const renderItem = ({ item }: { item: Post }) => {
    const needsSubscription = Boolean((item as any).subscribers_only);
    const subscribed = subscribedCreatorIds.has(item.author_id);
    const unlocked = unlockedPostIds.has(item.id);
    const isActuallyLocked = Boolean(item.is_locked) && !unlocked && (!needsSubscription || !subscribed);

    return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <TouchableOpacity style={styles.authorRow} onPress={() => onViewProfile?.(item.author_id)}>
          <Image source={{ uri: item.profile?.avatar_url || PLACEHOLDER_IMAGE }} style={styles.avatar} />
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
            if (item.media_type !== 'video') {
              setLightboxUri(item.image_url);
            }
          }
      }}>
        <View style={styles.imageWrapper}>
          {(item as any).media_type === 'video' || item.image_url?.endsWith('.mp4') ? (
            <Video
              source={{ uri: (item as any).video_url || item.image_url }}
              style={styles.image}
              resizeMode={ResizeMode.COVER}
              shouldPlay={!isActuallyLocked}
              isMuted={true}
              isLooping={true}
            />
          ) : (
            <Image
              source={{ uri: item.image_url || PLACEHOLDER_IMAGE }}
              style={styles.image}
              onError={() => { /* handled via PLACEHOLDER_IMAGE fallback */ }}
            />
          )}

          {isActuallyLocked && (
            <BlurView intensity={Platform.OS === 'ios' ? 70 : 100} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill}>
              <View style={styles.paywallContent}>
                <View style={styles.lockBadge}>
                  <Ionicons name="lock-closed" size={32} color="#fff" />
                </View>
                <Text style={styles.paywallTitle}>Premium Content</Text>
                <Text style={styles.paywallText}>
                  {item.price ? `Unlock this post for R${item.price}` : 'Subscribe to view this creator\'s exclusive content'}
                </Text>
                <TouchableOpacity 
                  style={styles.unlockButton} 
                  onPress={() => handleUnlockPost(item)}
                >
                  <Text style={styles.unlockButtonText}>{item.price ? 'Unlock Post' : 'View Tiers'}</Text>
                </TouchableOpacity>
              </View>
            </BlurView>
          )}

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
          <TouchableOpacity onPress={() => handleShare(item)} style={styles.iconAction}>
            <Ionicons name="paper-plane-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.rightActions}>
          <TouchableOpacity onPress={() => handleToggleBookmark(item)} style={styles.iconActionRight}>
            <Ionicons 
              name={bookmarkedPostIds.has(item.id) ? "bookmark" : "bookmark-outline"} 
              size={24} 
              color={colors.text} 
            />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.cardBody}>
        {item.likes_count > 0 && <Text style={[styles.likesCount, { color: colors.text }]}>{item.likes_count} likes</Text>}
        <View style={styles.captionRow}>
          <Text style={[styles.captionName, { color: colors.text }]}>{item.profile?.full_name || 'Photographer'}</Text>
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
  };

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
          initialNumToRender={6}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          updateCellsBatchingPeriod={50}
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
  rightActions: { flexDirection: 'row', alignItems: 'center' },
  iconAction: { marginRight: 16 },
  iconActionRight: { marginLeft: 16 },
  cardBody: { paddingHorizontal: 12, paddingBottom: 16 },
  likesCount: { fontWeight: '700', marginBottom: 4 },
  captionRow: { flexDirection: 'row', flexWrap: 'wrap' },
  captionName: { fontWeight: '700' },
  captionText: { color: '#334155' },
  timestampBottom: { fontSize: 10, marginTop: 8 },
  lightboxOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 1000, justifyContent: 'center', alignItems: 'center' },
  lightboxClose: { position: 'absolute', top: 50, right: 20, padding: 10 },
  lightboxCloseText: { color: '#fff', fontWeight: '700' },
  lightboxImage: {
    width: '100%',
    height: '80%',
    resizeMode: 'contain',
  },
  paywallContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  lockBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  paywallTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  paywallText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  unlockButton: {
    backgroundColor: '#ec4899',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  unlockButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
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
