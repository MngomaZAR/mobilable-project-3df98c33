import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle, TouchableWithoutFeedback } from 'react-native';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  onLongPress?: () => void;
};

export const AnimatedBubble: React.FC<Props> = ({ children, style, onLongPress }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }, [anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  const opacity = anim;

  const content = (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>{children}</Animated.View>
  );

  if (onLongPress) {
    return <TouchableWithoutFeedback onLongPress={onLongPress}>{content}</TouchableWithoutFeedback>;
  }

  return content;
};
