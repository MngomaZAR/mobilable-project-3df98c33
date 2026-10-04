import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Modal, Platform, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { reportContent } from '../services/reportService';
import { toggleFollow } from '../services/followService';
import { trackEvent } from '../services/analyticsService';
import { CreatorProfileDetail, fetchCreatorPosts, fetchCreatorProfile } from '../services/creatorProfileService';
import { fetchPublishedReviewSummary, ReviewSummary } from '../services/reviewService';
import { PLACEHOLDER_IMAGE } from '../utils/constants';
import { Post } from '../types';

type Route = RouteProp<RootStackParamList, 'UserProfile'>;
type Navigation = StackNavigationProp<RootStackParamList, 'UserProfile'>;
type ProfileLoad = { id: string; status: 'loading' | 'ready' | 'missing' | 'error'; data?: CreatorProfileDetail; error?: string };
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

const UserProfileScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { state, startConversationWithUser, setState } = useAppData();
  const userId = params.userId;
  const styles = makeStyles(colors);
  const [load, setLoad] = useState<ProfileLoad>({ id: userId, status: 'loading' });
  const [reload, setReload] = useState(0);
  const [postReload, setPostReload] = useState(0);
  const [reviewReload, setReviewReload] = useState(0);
  const [postResult, setPostResult] = useState<{ id: string; posts: Post[] } | null>(null);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postError, setPostError] = useState<string | null>(null);
  const [reviewResult, setReviewResult] = useState<{ id: string; summary: ReviewSummary } | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const followBusy = useRef(false);
  const chatBusy = useRef(false);
  const shareBusy = useRef(false);
  const reportBusy = useRef(false);
  const activeUserId = useRef(userId);
  const stateRef = useRef(state);
  activeUserId.current = userId;
  stateRef.current = state;

  useEffect(() => {
    let active = true;
    setLoad({ id: userId, status: 'loading' });
    setActionError(null);
    setReportOpen(false);
    setReportReason('');
    setReportError(null);
    void fetchCreatorProfile(userId).then(data => {
      if (active) setLoad({ id: userId, status: data ? 'ready' : 'missing', data: data ?? undefined });
    }).catch(error => {
      if (active) setLoad({ id: userId, status: 'error', error: errorMessage(error, 'Could not load this profile.') });
    });
    return () => { active = false; };
  }, [userId, reload]);

  const loaded = load.id === userId && load.status === 'ready' ? load.data : undefined;
  const profile = loaded?.profile;
  const talent = loaded?.talent;
  const isModel = profile?.role === 'model';
  const isOwnProfile = state.currentUser?.id === userId;
  const isFollowing = state.follows?.some(item => item.follower_id === state.currentUser?.id && item.following_id === userId) ?? false;
  const verified = Boolean(profile?.verified || profile?.kyc_status === 'approved');
  const rate = Number(talent?.hourly_rate);
  const canBook = Boolean(talent && verified && profile?.age_verified && !isOwnProfile);
  const summary = reviewResult?.id === userId ? reviewResult.summary : null;
  const name = talent?.name || profile?.full_name || 'Profile';
  const cachedPosts = useMemo(() => state.posts.filter(post => post.author_id === userId), [state.posts, userId]);
  const posts = postResult?.id === userId ? postResult.posts : cachedPosts;

  useEffect(() => {
    if (!loaded) return;
    let active = true;
    setPostsLoading(true);
    setPostError(null);
    void fetchCreatorPosts(userId).then(items => {
      if (active) setPostResult({ id: userId, posts: items });
    }).catch(error => {
      if (active) setPostError(errorMessage(error, 'Could not load recent work.'));
    }).finally(() => { if (active) setPostsLoading(false); });
    return () => { active = false; };
  }, [loaded, userId, postReload]);

  useEffect(() => {
    if (!talent) return;
    let active = true;
    setReviewError(null);
    void fetchPublishedReviewSummary(userId).then(value => {
      if (active) setReviewResult({ id: userId, summary: value });
    }).catch(error => {
      if (active) setReviewError(errorMessage(error, 'Published reviews are unavailable.'));
    });
    return () => { active = false; };
  }, [talent, userId, reviewReload]);

  const book = () => {
    if (!canBook) return;
    void trackEvent('booking_initiated', { creator_id: userId, source: 'profile' });
    navigation.navigate('BookingForm', isModel
      ? { modelId: userId, serviceType: 'modeling' }
      : { photographerId: userId, serviceType: 'photography' });
  };

  const message = async () => {
    if (!talent || isOwnProfile || chatBusy.current) return;
    chatBusy.current = true;
    setChatting(true);
    setActionError(null);
    try {
      // The server checks booking eligibility; a limited local cache must not deny an existing chat.
      const conversation = await startConversationWithUser(userId, name);
      if (activeUserId.current === userId) navigation.navigate('ChatThread', { conversationId: conversation.id, title: conversation.title });
    } catch (error) {
      if (activeUserId.current === userId) setActionError(errorMessage(error, 'Could not open this conversation.'));
    } finally { chatBusy.current = false; setChatting(false); }
  };

  const follow = async () => {
    const actorId = state.currentUser?.id;
    if (!actorId || isOwnProfile || followBusy.current) return;
    followBusy.current = true;
    setFollowing(true);
    setActionError(null);
    try {
      const nowFollowing = await toggleFollow(userId);
      if (stateRef.current.currentUser?.id !== actorId) return;
      const retained = (stateRef.current.follows ?? []).filter(item => !(item.follower_id === actorId && item.following_id === userId));
      setState({ follows: nowFollowing ? [...retained, { follower_id: actorId, following_id: userId, created_at: new Date().toISOString() }] : retained });
    } catch (error) {
      if (activeUserId.current === userId) setActionError(errorMessage(error, 'Could not update your follow.'));
    } finally { followBusy.current = false; setFollowing(false); }
  };

  const share = async () => {
    if (!profile || shareBusy.current) return;
    shareBusy.current = true;
    setSharing(true);
    setActionError(null);
    const url = `papzi://user/${encodeURIComponent(userId)}`;
    try {
      let shared = false;
      if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
        if (typeof navigator.share === 'function') {
          await navigator.share({ title: `${name} on Papzi`, text: `${name} on Papzi\n${url}` });
          shared = true;
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          setActionError('Profile link copied.');
        } else { throw new Error('Profile sharing is unavailable in this browser.'); }
      } else {
        const result = await Share.share({ title: `${name} on Papzi`, message: `${name} on Papzi\n${url}` });
        shared = result.action === Share.sharedAction;
      }
      if (shared) void trackEvent('profile_shared', { creator_id: userId, source: 'profile' });
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setActionError(errorMessage(error, 'Could not share this profile.'));
    } finally { shareBusy.current = false; setSharing(false); }
  };

  const report = async () => {
    if (reportBusy.current || !reportReason.trim() || !state.currentUser) return;
    reportBusy.current = true;
    setReporting(true);
    setReportError(null);
    try {
      await reportContent({ targetType: 'profile', targetId: userId, reason: reportReason.trim() });
      if (activeUserId.current === userId) {
        setReportOpen(false);
        setReportReason('');
        setActionError('Report submitted for review.');
      }
    } catch (error) {
      if (activeUserId.current === userId) setReportError(errorMessage(error, 'Could not submit the report.'));
    } finally { reportBusy.current = false; setReporting(false); }
  };

  const openExternal = async (value: string) => {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('This profile link is invalid.');
      await Linking.openURL(url.toString());
    } catch (error) { setActionError(errorMessage(error, 'Could not open this link.')); }
  };

  const button = (label: string, icon: React.ComponentProps<typeof Ionicons>['name'], action: () => void, disabled = false) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
      onPress={action} style={[styles.button, { opacity: disabled ? 0.5 : 1 }]}>
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );

  const header = (
    <View style={styles.profile}>
      <Image accessibilityLabel={`${name} profile photo`} source={{ uri: talent?.avatar_url || profile?.avatar_url || PLACEHOLDER_IMAGE }} style={styles.avatar} />
      <Text selectable style={styles.name}>{name}</Text>
      <Text style={styles.role}>{profile?.role === 'photographer' ? 'Photographer' : isModel ? 'Model' : 'Member'}</Text>
      <View style={styles.metadata}>
        {profile?.city ? <Text style={styles.secondary}>{profile.city}</Text> : null}
        {talent ? <Text style={styles.secondary}>{verified ? 'Identity verified' : 'Verification pending'}</Text> : null}
      </View>
      {profile?.bio ? <Text selectable style={styles.bio}>{profile.bio}</Text> : null}
      {talent?.tags?.length ? <Text style={styles.secondary}>{talent.tags.slice(0, 5).join(' / ')}</Text> : null}
      {talent ? <View style={styles.reviews}>
        {summary ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="View published reviews"
          onPress={() => navigation.navigate('Reviews', { photographerId: userId })} style={styles.reviewLink}>
          <Ionicons name="star-outline" size={18} color={colors.text} />
          <Text style={styles.buttonText}>{summary.count ? `${summary.average?.toFixed(1)} / 5 (${summary.count} ${summary.count === 1 ? 'review' : 'reviews'})` : 'No published reviews yet'}</Text>
        </TouchableOpacity> : reviewError ? <><Text selectable style={styles.secondary}>Published reviews unavailable</Text>{button('Retry reviews', 'refresh-outline', () => setReviewReload(value => value + 1))}</> : <Text style={styles.secondary}>Loading published reviews...</Text>}
      </View> : null}
      {talent ? <View style={styles.rateRow}>
        <View style={styles.rateDetails}>
          <Text style={styles.secondary}>{Number.isFinite(rate) && rate > 0 ? 'Published hourly rate' : 'Booking prices'}</Text>
          <Text selectable style={styles.rate}>{Number.isFinite(rate) && rate > 0 ? `R${rate.toLocaleString('en-ZA')} / hour` : isModel ? 'Priced by service' : 'View shoot packages'}</Text>
          <Text style={styles.secondary}>Scheduled shoots</Text>
        </View>
        {button('Request shoot', 'calendar-outline', book, !canBook)}
      </View> : null}
      {talent && !canBook && !isOwnProfile ? <Text style={styles.secondary}>This creator is not currently eligible for booking requests.</Text> : null}
      <View style={styles.actions}>
        {!isOwnProfile && state.currentUser ? button(isFollowing ? 'Following' : 'Follow', isFollowing ? 'checkmark-outline' : 'person-add-outline', () => void follow(), following) : null}
        {talent && !isOwnProfile ? button('Message', 'chatbubble-outline', () => void message(), chatting) : null}
        {button('View portfolio', 'images-outline', () => navigation.navigate('MediaLibrary', { creatorId: userId, title: `${name} Portfolio` }))}
      </View>
      {profile?.website || profile?.instagram ? <View style={styles.actions}>
        {profile.website ? button('Website', 'globe-outline', () => void openExternal(profile.website!)) : null}
        {profile.instagram ? button('Instagram', 'logo-instagram', () => void openExternal(`https://www.instagram.com/${encodeURIComponent(profile.instagram!.replace(/^@/, '').trim())}/`)) : null}
      </View> : null}
      {actionError ? <Text accessibilityRole="alert" selectable style={styles.feedback}>{actionError}</Text> : null}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent work</Text>
        {postError ? button('Retry recent work', 'refresh-outline', () => setPostReload(value => value + 1)) : null}
      </View>
      {postError && posts.length > 0 ? <Text selectable style={styles.feedback}>{postError} Showing previously loaded work.</Text> : null}
    </View>
  );

  const status = load.id === userId ? load.status : 'loading';
  return <View style={[styles.container, { paddingTop: Math.max(insets.top, 12), paddingBottom: insets.bottom }]}>
    <View style={styles.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={styles.iconButton}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text numberOfLines={2} style={styles.headerTitle}>{name}</Text>
      {loaded ? <>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Share profile" accessibilityState={{ disabled: sharing }} disabled={sharing} onPress={() => void share()} style={styles.iconButton}>
          <Ionicons name="share-outline" size={23} color={colors.text} />
        </TouchableOpacity>
        {!isOwnProfile && state.currentUser ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Report profile" onPress={() => { setReportError(null); setReportOpen(true); }} style={styles.iconButton}>
          <Ionicons name="flag-outline" size={22} color={colors.text} />
        </TouchableOpacity> : null}
      </> : null}
    </View>
    {status === 'ready' ? <FlatList
      data={posts} numColumns={3} keyExtractor={item => item.id} ListHeaderComponent={header}
      contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.listContent}
      renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open post ${item.caption || 'Recent work'}`}
        onPress={() => navigation.navigate('PostDetail', { postId: item.id })} style={styles.imageContainer}>
        <Image source={{ uri: item.image_url }} style={styles.image} />
      </TouchableOpacity>}
      ListEmptyComponent={<View style={styles.empty}>
        {postsLoading ? <ActivityIndicator accessibilityLabel="Loading recent work" color={colors.accent} /> : postError ? <>
          <Text selectable style={styles.secondary}>{postError}</Text>
          {button('Retry recent work', 'refresh-outline', () => setPostReload(value => value + 1))}
        </> : <Text style={styles.secondary}>No published work yet.</Text>}
      </View>}
    /> : <View style={styles.empty}>
      {status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading profile" color={colors.accent} /> : <>
        <Text selectable style={styles.feedback}>{status === 'error' ? load.error : 'This profile is unavailable.'}</Text>
        {status === 'error' ? button('Retry profile', 'refresh-outline', () => setReload(value => value + 1)) : null}
      </>}
    </View>}
    <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => { if (!reporting) setReportOpen(false); }}>
      <View style={styles.modalBackdrop}>
        <View accessibilityViewIsModal style={styles.reportDialog}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Report profile</Text>
          <TextInput accessibilityLabel="Report reason" value={reportReason} onChangeText={setReportReason} editable={!reporting}
            maxLength={1000} multiline placeholder="Reason" placeholderTextColor={colors.textSecondary} style={styles.reportInput} />
          {reportError ? <Text accessibilityRole="alert" style={styles.feedback}>{reportError}</Text> : null}
          <View style={styles.actions}>
            {button('Cancel report', 'close-outline', () => setReportOpen(false), reporting)}
            {button('Submit report', 'flag-outline', () => void report(), reporting || !reportReason.trim())}
          </View>
        </View>
      </View>
    </Modal>
  </View>;
};

const makeStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text, paddingVertical: 10 },
  listContent: { paddingBottom: 24, width: '100%', maxWidth: 800, alignSelf: 'center' },
  profile: { paddingHorizontal: 20, paddingTop: 24, gap: 12 },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.card },
  name: { color: colors.text, fontSize: 24, fontWeight: '700', flexShrink: 1 },
  role: { color: colors.textSecondary, fontSize: 15 },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  secondary: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  bio: { color: colors.text, fontSize: 15, lineHeight: 23 },
  reviews: { alignItems: 'flex-start' },
  reviewLink: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 44 },
  rateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: 16, alignItems: 'center' },
  rateDetails: { flexGrow: 1, flexShrink: 1, gap: 4 },
  rate: { color: colors.text, fontSize: 20, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 6, maxWidth: '100%', flexShrink: 1 },
  buttonText: { color: colors.text, fontWeight: '600', fontSize: 14, flexShrink: 1 },
  feedback: { color: colors.text, fontSize: 14, lineHeight: 21 },
  sectionHeader: { marginTop: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  sectionTitle: { color: colors.text, fontWeight: '700', fontSize: 18 },
  imageContainer: { width: '33.333333%', aspectRatio: 1, padding: 1 },
  image: { width: '100%', height: '100%', backgroundColor: colors.card },
  empty: { padding: 24, alignItems: 'center', gap: 16 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  reportDialog: { width: '100%', maxWidth: 440, padding: 20, gap: 16, borderRadius: 8, backgroundColor: colors.bg },
  reportInput: { minHeight: 100, padding: 12, borderWidth: 1, borderRadius: 6, borderColor: colors.border, color: colors.text, fontSize: 16, textAlignVertical: 'top' },
});

export default UserProfileScreen;
