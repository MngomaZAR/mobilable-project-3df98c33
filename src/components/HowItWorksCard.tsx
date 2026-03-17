import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Animated,
  PanResponder,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';

type Props = {
  title?: string;
  items: string[];
  dismissible?: boolean;
  persistKey?: string;
  variant?: 'default' | 'warning';
  containerStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  itemStyle?: StyleProp<TextStyle>;
};

const HowItWorksCard: React.FC<Props> = ({
  title = 'How It Works',
  items,
  dismissible = true,
  persistKey,
  variant = 'default',
  containerStyle,
  titleStyle,
  itemStyle,
}) => {
  const { colors, isDark } = useTheme();
  const [hidden, setHidden] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    const loadDismissed = async () => {
      if (!dismissible || !persistKey) return;
      try {
        const value = await AsyncStorage.getItem(`how-card-dismissed:${persistKey}`);
        if (active && value === '1') setHidden(true);
      } catch {
        // no-op
      }
    };
    loadDismissed();
    return () => {
      active = false;
    };
  }, [dismissible, persistKey]);

  const dismiss = useCallback(async () => {
    if (persistKey) {
      try {
        await AsyncStorage.setItem(`how-card-dismissed:${persistKey}`, '1');
      } catch {
        // no-op
      }
    }
    setHidden(true);
  }, [persistKey]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          dismissible && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          translateX.setValue(gesture.dx);
        },
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) > 90) {
            Animated.timing(translateX, {
              toValue: gesture.dx > 0 ? 420 : -420,
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              dismiss();
              translateX.setValue(0);
            });
            return;
          }
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        },
      }),
    [dismiss, dismissible, translateX],
  );

  if (hidden) return null;

  const warningBackground = isDark ? '#2a1f0a' : '#fff7ed';
  const warningBorder = isDark ? '#7c2d12' : '#fdba74';
  const warningText = isDark ? '#fdba74' : '#9a3412';

  return (
    <Animated.View
      {...(dismissible ? panResponder.panHandlers : {})}
      style={[{ transform: [{ translateX }] }]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: variant === 'warning' ? warningBackground : colors.card,
            borderColor: variant === 'warning' ? warningBorder : colors.border,
          },
          containerStyle,
        ]}
      >
      <View style={styles.header}>
        <Ionicons
          name={variant === 'warning' ? 'warning-outline' : 'information-circle-outline'}
          size={15}
          color={variant === 'warning' ? warningText : colors.textSecondary}
        />
        <Text
          style={[
            styles.title,
            { color: variant === 'warning' ? warningText : colors.text },
            titleStyle,
          ]}
        >
          {title}
        </Text>
        {dismissible ? (
          <TouchableOpacity onPress={dismiss} style={styles.closeBtn} accessibilityLabel="Close how it works card">
            <Ionicons name="close" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {items.map((item) => (
        <View key={item} style={styles.row}>
          <Text style={[styles.dot, { color: variant === 'warning' ? warningText : colors.textMuted }]}>•</Text>
          <Text
            style={[
              styles.item,
              { color: variant === 'warning' ? warningText : colors.textSecondary },
              itemStyle,
            ]}
          >
            {item}
          </Text>
        </View>
      ))}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  closeBtn: {
    marginLeft: 'auto',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 1,
  },
  dot: {
    marginRight: 5,
    lineHeight: 16,
    fontWeight: '700',
  },
  item: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
});

export default HowItWorksCard;
