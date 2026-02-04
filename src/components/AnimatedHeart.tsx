import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible?: boolean;
  size?: number;
  color?: string;
};

export const AnimatedHeart: React.FC<Props> = ({ visible = false, size = 96, color = '#ff375f' }) => {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    scale.setValue(0.2);
    burst.setValue(0.2);

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.25, duration: 160, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 220, delay: 200, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(burst, { toValue: 1.2, duration: 200, useNativeDriver: true }),
        Animated.timing(burst, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();
  }, [visible, opacity, scale, burst]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.wrapper, { opacity }]}>
      <Animated.View style={[styles.burst, { transform: [{ scale: burst }] }]} />
      <Animated.View style={{ transform: [{ scale }] }}>
        <Text style={[styles.heart, { fontSize: size, color }]}>{'❤️'}</Text>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -48 }, { translateY: -48 }],
    zIndex: 20,
  },
  burst: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,57,91,0.12)',
  },
  heart: {
    textShadowColor: 'rgba(0,0,0,0.15)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
});
