import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { logo } from '../assets/images';

type Props = {
  size?: number;
};

export const AppLogo: React.FC<Props> = ({ size = 96 }) => {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Image
        source={logo}
        style={{ width: '100%', height: '100%', resizeMode: 'contain', borderRadius: size * 0.15 }} 
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
