import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Text } from 'react-native';

const usePulse = () => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return anim;
};

export const FeedSkeleton: React.FC = () => {
  const pulse = usePulse();
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] });
  return (
    <View style={styles.feedContainer}>
      <Animated.View style={[styles.headerSkeleton, { opacity }]} />
      {[1, 2, 3].map((i) => (
        <View key={i} style={styles.cardSkeleton}>
          <Animated.View style={[styles.avatarSkeleton, { opacity }]} />
          <Animated.View style={[styles.titleSkeleton, { opacity }]} />
          <Animated.View style={[styles.imageSkeleton, { opacity }]} />
          <Animated.View style={[styles.lineSkeleton, { opacity }]} />
        </View>
      ))}
    </View>
  );
};

export const ChatSkeleton: React.FC = () => {
  const pulse = usePulse();
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] });
  return (
    <View style={styles.chatContainer}>
      <View style={styles.bannerPlaceholder}>
        <Text style={{ color: '#0f172a', fontWeight: '700' }}>Realtime chat</Text>
      </View>
      {[1, 2, 3, 4, 5].map((i) => (
        <Animated.View
          key={i}
          style={[
            styles.chatBubbleSkeleton,
            i % 2 === 0 ? styles.bubbleLeft : styles.bubbleRight,
            { opacity },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  feedContainer: { padding: 16 },
  headerSkeleton: { height: 36, width: '60%', backgroundColor: '#e6eef8', borderRadius: 8, marginBottom: 12 },
  cardSkeleton: { marginBottom: 18 },
  avatarSkeleton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#eef2f7', marginBottom: 8 },
  titleSkeleton: { height: 12, width: '40%', backgroundColor: '#eef2f7', borderRadius: 6, marginBottom: 8 },
  imageSkeleton: { height: 200, backgroundColor: '#eef2f7', borderRadius: 12, marginBottom: 8 },
  lineSkeleton: { height: 10, width: '70%', backgroundColor: '#eef2f7', borderRadius: 6 },

  chatContainer: { flex: 1, padding: 16, paddingBottom: 90, backgroundColor: '#f7f7fb' },
  bannerPlaceholder: { backgroundColor: '#e0f2fe', padding: 12, borderRadius: 12, marginBottom: 12 },
  chatBubbleSkeleton: { height: 40, borderRadius: 12, marginBottom: 10, backgroundColor: '#eef2f7' },
  bubbleLeft: { alignSelf: 'flex-start', width: '60%' },
  bubbleRight: { alignSelf: 'flex-end', width: '65%' },
});
