import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';

type Props = {
  uri?: string | null;
  size?: number;
  online?: boolean;
};

export const MapAvatarPin: React.FC<Props> = ({ uri, size = 52, online = false }) => {
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
});

