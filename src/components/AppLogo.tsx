import React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

type Props = {
  size?: number;
};

export const AppLogo: React.FC<Props> = ({ size = 96 }) => {
  const iconSize = size * 0.45;
  const pinSize = size * 0.28;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <LinearGradient
        colors={['#0f172a', '#111827']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.camera, { borderRadius: size * 0.18 }]}
      >
        <View style={styles.glow} />
        <Ionicons name="camera" size={iconSize} color="#f8fafc" />
        <View style={[styles.pinWrap, { width: pinSize, height: pinSize }]}>
          <Ionicons name="location" size={pinSize * 0.8} color="#0f172a" />
        </View>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  camera: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    shadowColor: '#0f172a',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  glow: {
    position: 'absolute',
    width: '92%',
    height: '92%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  pinWrap: {
    position: 'absolute',
    bottom: 12,
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});

