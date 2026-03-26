import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  uri?: string | null;
  size?: number;
  online?: boolean;
  rating?: number | null;
};

export const MapAvatarPin: React.FC<Props> = ({ uri, size = 52, online = false, rating }) => {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ringColor = online ? '#f1d6a4' : '#c7b293';
  const glowColor = online ? 'rgba(241,214,164,0.5)' : 'rgba(199,178,147,0.35)';

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View
        style={[
          styles.pulse,
          {
            backgroundColor: glowColor,
            width: size,
            height: size,
            borderRadius: size / 2,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.6] }) }],
          },
        ]}
      />
      <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: ringColor }]} />
      <View
        style={[
          styles.avatarWrap,
          {
            width: size - 10,
            height: size - 10,
            borderRadius: (size - 10) / 2,
          },
        ]}
      >
        <Image
          source={{
            uri:
              uri ||
              'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=200&q=80',
          }}
          style={styles.avatar}
        />
      </View>
      {Number.isFinite(rating) && (
        <View style={[styles.ratingBadge, { right: -2, bottom: -4 }]}>
          <Ionicons name="star" size={10} color="#fbbf24" />
          <View style={styles.ratingTextWrap}>
            <Animated.Text style={styles.ratingText}>{Number(rating).toFixed(1)}</Animated.Text>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
  },
  ring: {
    position: 'absolute',
    borderWidth: 3,
    shadowColor: '#d6b483',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  avatarWrap: {
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fffaf3',
    backgroundColor: '#ffffff',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  ratingBadge: {
    position: 'absolute',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(241, 214, 164, 0.6)',
  },
  ratingTextWrap: {
    minWidth: 24,
    alignItems: 'center',
  },
  ratingText: {
    color: '#f5e7cc',
    fontWeight: '800',
    fontSize: 10,
  },
});
