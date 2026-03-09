import React, { useMemo, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View, TouchableOpacity, Platform, Alert, Modal, TextInput } from 'react-native';
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
  
  const talent = useMemo(
    () => state.photographers.find((p) => p.id === params.userId) || state.models.find((m) => m.id === params.userId) || params.photographer,
    [params.photographer, params.userId, state.photographers, state.models]
  );
  
  const isFollowing = useMemo(
    () => state.follows?.some(f => f.following_id === talent?.id) ?? false,
    [state.follows, talent?.id]
  );

  const posts = useMemo(
    () => state.posts.filter((post) => post.author_id === params.userId),
    [state.posts, params.userId]
  );

  const handleMessage = async () => {
    if (!talent) return;
    try {
      const convo = await startConversationWithUser(talent.id, talent.name);
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch (e) {
      // handled in context
    }
  };

  const handleReport = () => {
    if (!talent) return;
    // We would ideally show an ActionSheet or Modal here, but for now we just use a confirm alert
    Platform.OS === 'web' 
      ? window.confirm('Report this user to admin?') && reportContent({ targetType: 'profile', targetId: talent.id, reason: 'Inappropriate content' })
      : Alert.alert('Report User', 'Report this user to admin?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Report', style: 'destructive', onPress: () => reportContent({ targetType: 'profile', targetId: talent.id, reason: 'Inappropriate content' }) }
        ]);
  };

  const handleTip = async () => {
    if (!talent || !tipAmount || isNaN(Number(tipAmount))) return;
    setIsSendingTip(true);
    try {
      const result = await sendTip(talent.id, Number(tipAmount));
      if (result.success) {
        setTipModalVisible(false);
        trackEvent('tip_sent', { creator_id: talent.id, amount: Number(tipAmount), source: 'profile' });
        Platform.OS === 'web' ? alert('Tip sent!') : Alert.alert('Success', `Sent R${tipAmount} tip!`);
      } else {
        const errorMsg = result.error.message || 'Unable to send tip.';
        Platform.OS === 'web' ? alert(errorMsg) : Alert.alert('Error', errorMsg);
      }
    } catch (e: any) {
      console.warn(e);
      const friendly = e.message || 'Something went wrong.';
      Platform.OS === 'web' ? alert(friendly) : Alert.alert('Error', friendly);
    } finally {
      setIsSendingTip(false);
    }
  };



  const handleToggleFollow = async () => {
    if (!talent || !state.currentUser) return;
    
    // Optimistic toggle locally
    const wasFollowing = isFollowing;
    const newFollows = [...(state.follows || [])];
    if (wasFollowing) {
        // Remove
        const idx = newFollows.findIndex(f => f.following_id === talent.id);
        if (idx !== -1) newFollows.splice(idx, 1);
    } else {
        // Add
        newFollows.push({ follower_id: state.currentUser.id, following_id: talent.id, created_at: new Date().toISOString() });
    }
    setState({ follows: newFollows });
    
    try {
        await toggleFollow(talent.id);
    } catch (e: any) {
        // Rollback on fail
        setState({ follows: state.follows });
        Alert.alert('Error', 'Failed to update follow status.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: Math.max(insets.top, 16) }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{talent?.name ?? 'Creator'}</Text>
        <TouchableOpacity style={{ marginLeft: 'auto' }} onPress={() => {
            if (!talent) return;
            Platform.OS === 'web' 
                ? window.confirm('Report this user to admin?') && reportContent({ targetType: 'profile', targetId: talent.id, reason: 'Inappropriate content' })
                : Alert.alert('Report User', 'Report this user to admin?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Report', style: 'destructive', onPress: () => reportContent({ targetType: 'profile', targetId: talent.id, reason: 'Inappropriate content' }) }
                    ]);
        }}>
          <Ionicons name="ellipsis-vertical" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>
      
      <View style={styles.profileInfo}>
        <Image 
          source={{ uri: talent?.avatar_url ?? PLACEHOLDER_IMAGE }} 
          style={styles.profileAvatar} 
        />
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {talent?.style ?? 'Visual storyteller'}
        </Text>
        <Text style={[styles.location, { color: colors.textMuted }]}>
          <Ionicons name="location-outline" size={14} /> {talent?.location ?? 'Cape Town'}
        </Text>
        
        <TouchableOpacity 
          style={[styles.smallFollowBtn, isFollowing ? { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border } : { backgroundColor: colors.text }]}
          onPress={handleToggleFollow}
          accessibilityLabel={isFollowing ? 'Unfollow talent' : 'Follow talent'}
        >
          <Text style={[styles.smallFollowBtnText, { color: isFollowing ? colors.text : colors.bg }]}>
             {isFollowing ? 'Following' : 'Follow'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.ratingRow} 
          onPress={() => talent && navigation.navigate('Reviews', { photographerId: talent.id })}
          accessibilityLabel={`Talent rating: ${talent?.rating?.toFixed(1) ?? '5.0'}. View reviews.`}
        >
          <Ionicons name="star" size={16} color="#fbbf24" />
          <Text style={[styles.ratingText, { color: colors.text }]}>{talent?.rating?.toFixed(1) ?? '5.0'} Rating</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.actionRow}>
          <TouchableOpacity 
            style={[styles.actionBtn, { backgroundColor: colors.accent }]} 
            onPress={handleMessage}
            accessibilityLabel="Message talent"
          >
            <Ionicons name="chatbubble-outline" size={18} color={isDark ? colors.bg : colors.card} />
            <Text style={[styles.actionBtnText, { color: isDark ? colors.bg : colors.card }]}>Message</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} 
            onPress={() => talent && navigation.navigate('CreatorSubscriptions', { creatorId: talent.id })}
          >
            <Ionicons name="star" size={18} color="#eab308" />
            <Text style={[styles.actionBtnText, { color: colors.text }]}>Subscribe</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.actionRow, { marginTop: 10 }]}>
            <TouchableOpacity 
              style={[styles.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} 
              onPress={() => talent && navigation.navigate('MediaLibrary', { creatorId: talent.id, title: `${talent.name}'s Media` })}
              accessibilityLabel="View talent's premium media library"
            >
              <Ionicons name="images" size={18} color="#8b5cf6" />
              <Text style={[styles.actionBtnText, { color: colors.text }]}>Premium Media</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} 
              onPress={() => setTipModalVisible(true)}
            >
              <Ionicons name="heart" size={18} color="#ec4899" />
              <Text style={[styles.actionBtnText, { color: colors.text }]}>Send Tip</Text>
            </TouchableOpacity>
        </View>
      </View>

      <Modal visible={tipModalVisible} transparent animationType="slide" onRequestClose={() => setTipModalVisible(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { backgroundColor: colors.bg }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Send Tip</Text>
              <TouchableOpacity onPress={() => setTipModalVisible(false)} style={styles.iconBtn}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Amount in ZAR</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                keyboardType="numeric"
                value={tipAmount}
                onChangeText={setTipAmount}
                placeholder="50"
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.presets}>
                {['20', '50', '100', '250'].map(p => (
                  <TouchableOpacity key={p} style={[styles.presetBtn, { backgroundColor: colors.card, borderColor: colors.border }, tipAmount === p && { backgroundColor: colors.accent, borderColor: colors.accent }]} onPress={() => setTipAmount(p)}>
                    <Text style={[styles.presetText, { color: colors.text }, tipAmount === p && { color: colors.card }]}>R{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity 
                style={[styles.confirmBtn, { backgroundColor: colors.accent }]} 
                onPress={handleTip} 
                disabled={isSendingTip}
              >
                <Text style={[styles.confirmBtnText, { color: colors.card }]}>{isSendingTip ? 'Sending...' : 'Send Tip'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        numColumns={3}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.imageContainer}>
            <Image source={{ uri: item.image_url }} style={styles.image} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={[styles.empty, { color: colors.textMuted }]}>No posts yet.</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    marginRight: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
  },
  profileInfo: {
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  profileAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 12,
    backgroundColor: '#f1f5f9',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  location: {
    fontSize: 14,
    marginBottom: 8,
  },
  smallFollowBtn: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 16,
  },
  smallFollowBtnText: {
    fontWeight: '700',
    fontSize: 13,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.04)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 16,
  },
  ratingText: {
    fontWeight: '700',
    fontSize: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    justifyContent: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
    flex: 1,
    justifyContent: 'center',
  },
  actionBtnText: {
    fontWeight: '700',
  },
  listContent: {
    padding: 2,
  },
  imageContainer: {
    width: '33.33%',
    aspectRatio: 1,
    padding: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  iconBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  modalBody: {
    gap: 16,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalInput: {
    padding: 16,
    borderRadius: 12,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    borderWidth: 1,
  },
  presets: {
    flexDirection: 'row',
    gap: 8,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
  },
  presetText: {
    fontWeight: '700',
  },
  confirmBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  confirmBtnText: {
    fontSize: 18,
    fontWeight: '800',
  },
});

export default UserProfileScreen;
