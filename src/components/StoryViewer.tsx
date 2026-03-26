import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Modal, Dimensions, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

export const StoryViewer: React.FC<StoryViewerProps> = ({ stories, visible, onClose, initialIndex = 0 }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const insets = useSafeAreaInsets();
  const progressAnim = useRef(new Animated.Value(0)).current;

  function nextStory() {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      onClose();
    }
  }

  function startAnimation() {
    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: (stories[currentIndex]?.duration || 5) * 1000,
      easing: Easing.linear,
      useNativeDriver: false, // width is not supported by native driver
    }).start(({ finished }) => {
      if (finished) {
        nextStory();
      }
    });
  }

  function prevStory() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else {
      // If on the first story of a user, we might want to go to the previous user's stories
      // But for simplicity in this component, we just reset the current story
      progressAnim.setValue(0);
      startAnimation();
    }
  }

  useEffect(() => {
    if (visible && stories.length > 0) {
      startAnimation();
    } else {
      progressAnim.setValue(0);
    }
  }, [visible, currentIndex, stories, progressAnim]);

  const handlePress = (evt: any) => {
    const x = evt.nativeEvent.locationX;
    if (x < width / 3) {
      prevStory();
    } else {
      nextStory();
    }
  };

  if (!visible || stories.length === 0) return null;

  const currentStory = stories[currentIndex];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <TouchableOpacity activeOpacity={1} style={styles.content} onPress={handlePress}>
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
                <Image source={{ uri: currentStory.profile?.avatar_url }} style={styles.avatar} />
                <Text style={styles.username}>{currentStory.profile?.full_name}</Text>
                <Text style={styles.timeAgo}>2h</Text> {/* Placeholder: calculate real time ago */}
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
                 <Text style={styles.replyPlaceholder}>Send message...</Text>
                 <Ionicons name="paper-plane-outline" size={20} color="#fff" />
             </View>
          </LinearGradient>
        </TouchableOpacity>
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
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.4)',
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginBottom: 10,
  },
  replyPlaceholder: {
      color: 'rgba(255,255,255,0.8)',
      fontSize: 15,
  }
});
