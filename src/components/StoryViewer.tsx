import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Dimensions, Easing, Image, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { PLACEHOLDER_AVATAR } from '../utils/constants';

export interface Story {
  id: string;
  author_id: string;
  media_url: string;
  media_type: 'image' | 'video';
  created_at: string;
  duration: number; // in seconds
  profile?: {
    full_name: string;
    avatar_url: string;
  };
}

interface StoryViewerProps {
  stories: Story[];
  visible: boolean;
  onClose: () => void;
  initialIndex?: number;
}

const { width, height } = Dimensions.get('window');

const formatStoryTimeAgo = (createdAt: string) => {
  const then = new Date(createdAt).getTime();
  if (!Number.isFinite(then)) return 'now';
  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

export const StoryViewer: React.FC<StoryViewerProps> = ({ stories, visible, onClose, initialIndex = 0 }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [replyText, setReplyText] = useState('');
  const [replyFocused, setReplyFocused] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { startConversationWithUser, sendMessage } = useAppData();
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pausedProgressRef = useRef(0);

  function nextStory() {
    pausedProgressRef.current = 0;
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      onClose();
    }
  }

  function startAnimation(from = 0) {
    progressAnim.setValue(from);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: Math.max(150, (stories[currentIndex]?.duration || 5) * 1000 * (1 - from)),
      easing: Easing.linear,
      useNativeDriver: false, // width is not supported by native driver
    }).start(({ finished }) => {
      if (finished) {
        pausedProgressRef.current = 0;
        nextStory();
      }
    });
  }

  function prevStory() {
    pausedProgressRef.current = 0;
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else {
      // If on the first story of a user, we might want to go to the previous user's stories
      // But for simplicity in this component, we just reset the current story
      progressAnim.setValue(0);
      pausedProgressRef.current = 0;
      startAnimation();
    }
  }

  useEffect(() => {
    if (!visible || stories.length === 0) {
      progressAnim.stopAnimation();
      progressAnim.setValue(0);
      pausedProgressRef.current = 0;
      setReplyText('');
      return;
    }
    if (replyFocused) {
      progressAnim.stopAnimation((value) => {
        pausedProgressRef.current = value;
      });
      return;
    }
    startAnimation(pausedProgressRef.current);
  }, [visible, currentIndex, stories, progressAnim, replyFocused]);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex, visible]);

  if (!visible || stories.length === 0) return null;

  const currentStory = stories[currentIndex];
  const timeAgo = formatStoryTimeAgo(currentStory.created_at);

  const handleReplySubmit = async () => {
    const trimmed = replyText.trim();
    if (!trimmed) return;
    try {
      setSendingReply(true);
      const title = currentStory.profile?.full_name ?? 'Story reply';
      const convo = await startConversationWithUser(currentStory.author_id, title);
      await sendMessage(convo.id, trimmed, true);
      setReplyText('');
      setReplyFocused(false);
      onClose();
      navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch (error: any) {
      Alert.alert('Unable to send', error?.message || 'Please try again.');
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Image source={{ uri: currentStory.media_url }} style={styles.image} resizeMode="cover" />
          
          <LinearGradient
            colors={['rgba(0,0,0,0.5)', 'transparent']}
            style={[styles.overlayTop, { paddingTop: Math.max(insets.top, 20) }]}
          >
            {/* Progress Bars */}
            <View style={styles.progressContainer}>
              {stories.map((story, index) => (
                <View key={story.id} style={styles.progressBarBg}>
                  <Animated.View
                    style={[
                      styles.progressBarFill,
                      {
                        width: index === currentIndex
                          ? progressAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0%', '100%'],
                            })
                          : index < currentIndex
                          ? '100%'
                          : '0%',
                      },
                    ]}
                  />
                </View>
              ))}
            </View>

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.userInfo}>
                <Image source={{ uri: currentStory.profile?.avatar_url || PLACEHOLDER_AVATAR }} style={styles.avatar} />
                <Text style={styles.username}>{currentStory.profile?.full_name}</Text>
                <Text style={styles.timeAgo}>{timeAgo}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
          </LinearGradient>
          
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.8)']}
            style={[styles.overlayBottom, { paddingBottom: Math.max(insets.bottom, 20) }]}
          >
             <View style={styles.replyInput}>
                 <TextInput
                   value={replyText}
                   onChangeText={setReplyText}
                   onFocus={() => setReplyFocused(true)}
                   onBlur={() => setReplyFocused(false)}
                   onSubmitEditing={handleReplySubmit}
                   placeholder="Send message..."
                   placeholderTextColor="rgba(255,255,255,0.72)"
                   style={styles.replyTextInput}
                   editable={!sendingReply}
                   returnKeyType="send"
                 />
                 <TouchableOpacity onPress={handleReplySubmit} disabled={sendingReply || !replyText.trim()} style={styles.sendBtn}>
                   <Ionicons name={sendingReply ? 'hourglass-outline' : 'paper-plane-outline'} size={20} color="#fff" />
                 </TouchableOpacity>
             </View>
          </LinearGradient>
          <TouchableOpacity style={[styles.tapZone, styles.tapZoneLeft]} onPress={prevStory} activeOpacity={1} />
          <TouchableOpacity style={[styles.tapZone, styles.tapZoneRight]} onPress={nextStory} activeOpacity={1} />
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  content: {
    flex: 1,
  },
  image: {
    width: width,
    height: height,
    position: 'absolute',
  },
  overlayTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    paddingHorizontal: 10,
  },
  progressContainer: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 10,
  },
  progressBarBg: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#fff',
  },
  username: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 4,
  },
  timeAgo: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtn: {
    padding: 5,
  },
  overlayBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
  },
  replyInput: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.4)',
      borderRadius: 999,
      paddingLeft: 16,
      paddingRight: 10,
      paddingVertical: 8,
      marginBottom: 10,
  },
  replyTextInput: {
      flex: 1,
      color: 'rgba(255,255,255,0.8)',
      fontSize: 15,
      paddingVertical: 8,
  },
  sendBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
  },
  tapZone: {
    position: 'absolute',
    top: 120,
    bottom: 120,
    width: width / 2,
  },
  tapZoneLeft: {
    left: 0,
  },
  tapZoneRight: {
    right: 0,
  },
});
