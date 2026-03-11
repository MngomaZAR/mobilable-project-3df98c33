import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { AppLogo } from '../components/AppLogo';

/**
 * SplashLoadingScreen — shown while the auth session is being resolved.
 * Replaces the blank `null` return in MainNavigator during loading.
 */
const SplashLoadingScreen: React.FC = () => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Fade in
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    // Gentle pulse loop on the logo
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [fadeAnim, pulseAnim]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <AppLogo size={96} />
        </Animated.View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    gap: 24,
  },
});

export default SplashLoadingScreen;
