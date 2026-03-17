import React, { useMemo, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View, TouchableOpacity, Platform, Alert, Modal, TextInput, ActionSheetIOS, Linking, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { reportContent } from '../services/reportService';
import { sendTip } from '../services/monetisationService';
import { toggleFollow } from '../services/followService';
import { trackEvent } from '../services/analyticsService';
import { PLACEHOLDER_IMAGE } from '../utils/constants';
import { getStatusLeaderboard } from '../services/dispatchService';
import { supabase } from '../config/supabaseClient';

type Route = RouteProp<RootStackParamList, 'UserProfile'>;
type Navigation = StackNavigationProp<RootStackParamList, 'UserProfile'>;

const UserProfileScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { state, startConversationWithUser, setState } = useAppData();
  
  const [tipModalVisible, setTipModalVisible] = useState(false);
  const [tipAmount, setTipAmount] = useState('50');
  const [isSendingTip, setIsSendingTip] = useState(false);
  const [activeTab, setActiveTab] = useState<'grid' | 'portfolio' | 'tagged'>('grid');
  const [seenScore, setSeenScore] = useState<number>(0);
  const [sceneRank, setSceneRank] = useState<number>(0);
  const [localTrendRank, setLocalTrendRank] = useState<number | null>(null);
  
  const s = makeStyles(colors);

  const talent = useMemo(
    () => state.photographers.find((p) => p.id === params.userId) || state.models.find((m) => m.id === params.userId) || params.photographer,
    [params.photographer, params.userId, state.photographers, state.models]
  );
  
  const profileFallback = useMemo(
    () => state.profiles.find((p) => p.id === params.userId),
    [state.profiles, params.userId]
  );
  
  const isFollowing = useMemo(
    () => state.follows?.some(f => f.following_id === talent?.id) ?? false,
    [state.follows, talent?.id]
  );

  const posts = useMemo(
    () => state.posts.filter((post) => post.author_id === params.userId),
    [state.posts, params.userId]
  );

  React.useEffect(() => {
    let active = true;
    const hydrateStatus = async () => {
      const userId = params.userId;
      try {
        const [{ data: score }, board] = await Promise.all([
          supabase.from('status_scores').select('seen_score,scene_rank').eq('user_id', userId).maybeSingle(),
          getStatusLeaderboard({ city: talent?.location || profileFallback?.city || 'Cape Town', limit: 100 }),
        ]);
        if (!active) return;
        setSeenScore(Number(score?.seen_score || 0));
        setSceneRank(Number(score?.scene_rank || 0));
        const idx = (board.leaderboard ?? []).findIndex((entry) => entry.user_id === userId);
        setLocalTrendRank(idx >= 0 ? idx + 1 : null);
      } catch {
        if (!active) return;
        setSeenScore(0);
        setSceneRank(0);
        setLocalTrendRank(null);
      }
    };
    hydrateStatus();
    return () => { active = false; };
  }, [params.userId, talent?.location, profileFallback?.city]);

  const pinnedPosts = useMemo(
    () => posts.filter(p => talent?.pinned_post_ids?.includes(p.id)).slice(0, 3),
    [posts, talent?.pinned_post_ids]
  );

  const handleMessage = async () => {
    const targetId = params.userId;
    const targetName = talent?.name ?? profileFallback?.full_name ?? 'User';
    try {
      const convo = await startConversationWithUser(targetId, targetName);
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch (e) {}
  };

  const handleReport = async () => {
    const targetId = talent?.id ?? params.userId;
    if (!targetId) return;
    const reasons = ['Inappropriate content', 'Spam', 'Fake profile', 'Harassment', 'Other'];
    
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', ...reasons], cancelButtonIndex: 0, title: 'Report this user' },
        async (index) => {
          if (index === 0) return;
          try {
            await reportContent({ targetType: 'profile', targetId, reason: reasons[index - 1] });
            Alert.alert('Reported', 'Thank you. Our team will review this.');
          } catch (e) {
            Alert.alert('Error', 'Failed to submit report.');
          }
        }
      );
    } else {
      Alert.alert('Report User', 'Why are you reporting this?',
        [
          ...reasons.map(reason => ({
            text: reason,
            onPress: async () => {
              try {
                await reportContent({ targetType: 'profile', targetId, reason });
                Alert.alert('Reported', 'Thank you. Our team will review this.');
              } catch (e) {
                Alert.alert('Error', 'Failed to submit report.');
              }
            }
          })),
          { text: 'Cancel', style: 'cancel' }
        ]
      );
    }
  };

  const handleTip = async () => {
    if (!talent || !tipAmount || isNaN(Number(tipAmount))) return;
    setIsSendingTip(true);
    try {
      const result = await sendTip(talent.id, Number(tipAmount));
      if (result.success) {
        setTipModalVisible(false);
        trackEvent('tip_sent', { creator_id: talent.id, amount: Number(tipAmount), source: 'profile' });
        Alert.alert('Success', `Sent R${tipAmount} tip!`);
      } else {
        const errorMsg = result.error.message || 'Unable to send tip.';
        Alert.alert('Error', errorMsg);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Something went wrong.');
    } finally {
      setIsSendingTip(false);
    }
  };

  const handleToggleFollow = async () => {
    if (!talent || !state.currentUser) return;
    const wasFollowing = isFollowing;
    const newFollows = [...(state.follows || [])];
    if (wasFollowing) {
        const idx = newFollows.findIndex(f => f.following_id === talent.id);
        if (idx !== -1) newFollows.splice(idx, 1);
    } else {
        newFollows.push({ follower_id: state.currentUser.id, following_id: talent.id, created_at: new Date().toISOString() });
    }
    setState({ follows: newFollows });
    try {
        await toggleFollow(talent.id);
    } catch (e: any) {
        setState({ follows: state.follows });
        Alert.alert('Error', 'Failed to update follow status.');
    }
  };

  const handleCollaborate = () => {
    Alert.alert('Collaboration Request', `Send a collab request to ${talent?.name || 'this creator'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send Request', onPress: () => Alert.alert('Sent', 'Collaboration request sent successfully!') }
    ]);
  };

  const renderHeader = () => (
    <View style={s.profileInfo}>
      <View style={s.avatarWrapper}>
        <Image source={{ uri: talent?.avatar_url ?? PLACEHOLDER_IMAGE }} style={s.profileAvatar} />
        {talent?.is_online && (
          <View style={s.onlineBadge}>
             <View style={s.onlineDot} />
             <Text style={s.onlineText}>AVAILABLE NOW</Text>
          </View>
        )}
      </View>
      
      <Text style={[s.subtitle, { color: colors.textSecondary }]}>{talent?.style ?? 'Visual storyteller'}</Text>
      
      <View style={s.metaRow}>
        <Text style={[s.location, { color: colors.textMuted }]}>
          <Ionicons name="location-outline" size={14} /> {talent?.location ?? 'Cape Town'}
        </Text>
        <View style={s.dot} />
        <Text style={[s.location, { color: colors.textMuted }]}>
          {talent?.experience_years ? `${talent.experience_years}y Experience` : 'Member'}
        </Text>
      </View>

      {/* Specialties Tags */}
      {(talent?.specialties || talent?.tags) && (
        <View style={s.tagsScroll}>
          {(talent?.specialties || talent?.tags || []).slice(0, 5).map((tag, i) => (
            <View key={i} style={[s.tag, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[s.tagText, { color: colors.textSecondary }]}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
      
      <View style={s.followRow}>
        <TouchableOpacity 
          style={[s.smallFollowBtn, isFollowing ? { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border } : { backgroundColor: colors.text }]}
          onPress={handleToggleFollow}
        >
          <Text style={[s.smallFollowBtnText, { color: isFollowing ? colors.text : colors.bg }]}>
             {isFollowing ? 'Following' : 'Follow'}
          </Text>
        </TouchableOpacity>

        {state.currentUser?.role && state.currentUser.id !== talent?.id && (
           <TouchableOpacity 
            style={[s.smallFollowBtn, { backgroundColor: colors.accent, marginLeft: 8 }]}
            onPress={handleCollaborate}
          >
            <Text style={[s.smallFollowBtnText, { color: colors.bg }]}>Collaborate</Text>
          </TouchableOpacity>
        )}
      </View>
      
      <TouchableOpacity 
        style={s.ratingRow} 
        onPress={() => talent && navigation.navigate('Reviews', { photographerId: talent.id })}
      >
        <Ionicons name="star" size={16} color="#fbbf24" />
        <Text style={[s.ratingText, { color: colors.text }]}>{talent?.rating?.toFixed(1) ?? '5.0'} Rating</Text>
        <Text style={{ color: colors.textMuted, fontSize: 13, marginLeft: 4 }}>(128 reviews)</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={[s.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[s.sectionTitle, { color: colors.textSecondary }]}>STATUS GRAPH</Text>
        <View style={s.statusRow}>
          <View style={s.statusMetric}>
            <Text style={[s.statusValue, { color: colors.text }]}>{seenScore}</Text>
            <Text style={[s.statusLabel, { color: colors.textMuted }]}>Seen Score</Text>
          </View>
          <View style={s.statusMetric}>
            <Text style={[s.statusValue, { color: colors.text }]}>{sceneRank}</Text>
            <Text style={[s.statusLabel, { color: colors.textMuted }]}>Scene Rank</Text>
          </View>
          <View style={s.statusMetric}>
            <Text style={[s.statusValue, { color: colors.text }]}>{localTrendRank ? `#${localTrendRank}` : '-'}</Text>
            <Text style={[s.statusLabel, { color: colors.textMuted }]}>Local Trend</Text>
          </View>
        </View>
      </View>

      {/* Highlight Reel */}
      {pinnedPosts.length > 0 && (
        <View style={s.highlightSection}>
           <Text style={[s.sectionTitle, { color: colors.textSecondary }]}>HIGHLIGHT REEL</Text>
           <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.highlightScroll}>
              {pinnedPosts.map(post => (
                <TouchableOpacity key={post.id} style={s.highlightItem} onPress={() => navigation.navigate('PostDetail', { postId: post.id })}>
                   <Image source={{ uri: post.image_url }} style={s.highlightImage} />
                   <View style={s.pinBadge}>
                      <Ionicons name="pin" size={12} color="#fff" />
                   </View>
                </TouchableOpacity>
              ))}
           </ScrollView>
        </View>
      )}

      {/* Price Card */}
      {talent?.hourly_rate && (
        <View style={[s.priceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View>
            <Text style={[s.priceLabel, { color: colors.textMuted }]}>HOURLY RATE</Text>
            <Text style={[s.priceValue, { color: colors.text }]}>R{talent.hourly_rate}</Text>
          </View>
          <TouchableOpacity 
            style={[s.bookBtn, { backgroundColor: colors.text }]}
            onPress={() => {
              if (state.photographers.some(p => p.id === talent.id)) {
                navigation.navigate('BookingForm', { photographerId: talent.id });
              } else {
                navigation.navigate('BookingForm', { modelId: talent.id });
              }
            }}
          >
            <Text style={[s.bookBtnText, { color: colors.bg }]}>Book Me</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={s.socialLinks}>
         <TouchableOpacity onPress={() => talent?.website && Linking.openURL(talent.website)}>
           <Ionicons name="globe-outline" size={24} color={colors.textSecondary} />
         </TouchableOpacity>
         <TouchableOpacity onPress={() => talent?.instagram && Linking.openURL(`https://instagram.com/${talent.instagram}`)}>
           <Ionicons name="logo-instagram" size={24} color={colors.textSecondary} />
         </TouchableOpacity>
         <TouchableOpacity onPress={() => talent?.tiktok && Linking.openURL(`https://tiktok.com/@${talent.tiktok}`)}>
           <Ionicons name="logo-tiktok" size={24} color={colors.textSecondary} />
         </TouchableOpacity>
      </View>

      <View style={s.actionRow}>
        <TouchableOpacity style={[s.actionBtn, { backgroundColor: colors.accent }]} onPress={handleMessage}>
          <Ionicons name="chatbubble-outline" size={18} color={isDark ? colors.bg : colors.card} />
          <Text style={[s.actionBtnText, { color: isDark ? colors.bg : colors.card }]}>Message</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} onPress={() => talent && navigation.navigate('CreatorSubscriptions', { creatorId: talent.id })}>
          <Ionicons name="star" size={18} color="#eab308" />
          <Text style={[s.actionBtnText, { color: colors.text }]}>Subscribe</Text>
        </TouchableOpacity>
      </View>

      <View style={[s.actionRow, { marginTop: 10 }]}>
          <TouchableOpacity style={[s.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} onPress={() => setTipModalVisible(true)}>
            <Ionicons name="heart" size={18} color="#ec4899" />
            <Text style={[s.actionBtnText, { color: colors.text }]}>Send Tip</Text>
          </TouchableOpacity>
      </View>

      <View style={s.tabBar}>
        <TouchableOpacity style={[s.tab, activeTab === 'grid' && s.activeTab]} onPress={() => setActiveTab('grid')}>
          <Ionicons name="grid" size={22} color={activeTab === 'grid' ? colors.accent : colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, activeTab === 'portfolio' && s.activeTab]} onPress={() => setActiveTab('portfolio')}>
          <Ionicons name="images" size={22} color={activeTab === 'portfolio' ? colors.accent : colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, activeTab === 'tagged' && s.activeTab]} onPress={() => setActiveTab('tagged')}>
          <Ionicons name="person-circle-outline" size={24} color={activeTab === 'tagged' ? colors.accent : colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.bg, paddingTop: Math.max(insets.top, 16) }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.text }]}>{talent?.name ?? profileFallback?.full_name ?? 'Creator'}</Text>
        <TouchableOpacity style={{ marginLeft: 'auto' }} onPress={handleReport}>
          <Ionicons name="ellipsis-vertical" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <FlatList
        ListHeaderComponent={renderHeader}
        data={activeTab === 'grid' ? posts : []}
        keyExtractor={(item) => item.id}
        numColumns={3}
        contentContainerStyle={s.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.imageContainer} onPress={() => navigation.navigate('PostDetail', { postId: item.id })}>
            <Image source={{ uri: item.image_url }} style={s.image} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={s.emptyContainer}>
            <Ionicons name={activeTab === 'grid' ? "images-outline" : "albums-outline"} size={48} color={colors.textMuted} />
            <Text style={[s.empty, { color: colors.textMuted }]}>
              {activeTab === 'grid' ? 'No posts yet.' : 'Portfolio gallery coming soon.'}
            </Text>
          </View>
        }
      />

      <Modal visible={tipModalVisible} transparent animationType="slide" onRequestClose={() => setTipModalVisible(false)}>
        <View style={s.modalBg}>
          <View style={[s.modalContent, { backgroundColor: colors.bg }]}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: colors.text }]}>Send Tip</Text>
              <TouchableOpacity onPress={() => setTipModalVisible(false)} style={s.iconBtn}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={s.modalBody}>
              <Text style={[s.modalLabel, { color: colors.textSecondary }]}>Amount in ZAR</Text>
              <TextInput
                style={[s.modalInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                keyboardType="numeric"
                value={tipAmount}
                onChangeText={setTipAmount}
                placeholder="50"
                placeholderTextColor={colors.textMuted}
              />
              <View style={s.presets}>
                {['20', '50', '100', '250'].map(p => (
                  <TouchableOpacity key={p} style={[s.presetBtn, { backgroundColor: colors.card, borderColor: colors.border }, tipAmount === p && { backgroundColor: colors.accent, borderColor: colors.accent }]} onPress={() => setTipAmount(p)}>
                    <Text style={[s.presetText, { color: colors.text }, tipAmount === p && { color: colors.card }]}>R{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={[s.confirmBtn, { backgroundColor: colors.accent }]} onPress={handleTip} disabled={isSendingTip}>
                <Text style={[s.confirmBtnText, { color: colors.card }]}>{isSendingTip ? 'Sending...' : 'Send Tip'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const makeStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  backButton: { marginRight: 12 },
  title: { fontSize: 20, fontWeight: '800' },
  profileInfo: { alignItems: 'center' },
  avatarWrapper: { position: 'relative', marginBottom: 12 },
  profileAvatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#f1f5f9' },
  onlineBadge: { position: 'absolute', bottom: -5, right: -5, backgroundColor: '#10b981', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: colors.bg },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff', marginRight: 4 },
  onlineText: { color: '#fff', fontSize: 8, fontWeight: '900' },
  subtitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textMuted, marginHorizontal: 8 },
  location: { fontSize: 14 },
  tagsScroll: { flexDirection: 'row', gap: 6, marginBottom: 16, paddingHorizontal: 20, flexWrap: 'wrap', justifyContent: 'center' },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  tagText: { fontSize: 11, fontWeight: '600' },
  followRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  smallFollowBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 999 },
  smallFollowBtnText: { fontWeight: '700', fontSize: 13 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.04)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginBottom: 20 },
  ratingText: { fontWeight: '700', fontSize: 14 },
  statusCard: { width: '90%', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 18 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6 },
  statusMetric: { alignItems: 'center', flex: 1 },
  statusValue: { fontSize: 18, fontWeight: '900' },
  statusLabel: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  highlightSection: { width: '100%', marginBottom: 20 },
  sectionTitle: { fontSize: 10, fontWeight: '800', marginLeft: 20, marginBottom: 10, letterSpacing: 1 },
  highlightScroll: { paddingHorizontal: 16 },
  highlightItem: { width: 140, height: 180, marginRight: 10, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  highlightImage: { width: '100%', height: '100%' },
  pinBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.5)', width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  socialLinks: { flexDirection: 'row', gap: 20, marginBottom: 20, marginTop: 4 },
  priceCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '90%', padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 20 },
  priceLabel: { fontSize: 10, fontWeight: '800' },
  priceValue: { fontSize: 20, fontWeight: '900' },
  bookBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  bookBtnText: { fontWeight: '800', fontSize: 14 },
  actionRow: { flexDirection: 'row', gap: 10, width: '100%', justifyContent: 'center', paddingHorizontal: 20 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, gap: 8, flex: 1, justifyContent: 'center' },
  actionBtnText: { fontWeight: '700', fontSize: 13 },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 20, width: '100%' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: colors.accent },
  listContent: { padding: 1 },
  imageContainer: { width: '33.33%', aspectRatio: 1, padding: 1 },
  image: { width: '100%', height: '100%' },
  emptyContainer: { alignItems: 'center', paddingVertical: 60, width: '100%' },
  empty: { textAlign: 'center', marginTop: 12, fontWeight: '600' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 22, fontWeight: '800' },
  iconBtn: { padding: 8, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.05)' },
  modalBody: { gap: 16 },
  modalLabel: { fontSize: 14, fontWeight: '700' },
  modalInput: { padding: 16, borderRadius: 12, fontSize: 24, fontWeight: '800', textAlign: 'center', borderWidth: 1 },
  presets: { flexDirection: 'row', gap: 8 },
  presetBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', borderWidth: 1 },
  presetText: { fontWeight: '700' },
  confirmBtn: { paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  confirmBtnText: { fontSize: 18, fontWeight: '800' },
});

export default UserProfileScreen;
