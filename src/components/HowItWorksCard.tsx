import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';

type Props = {
  title?: string;
  items: string[];
  containerStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  itemStyle?: StyleProp<TextStyle>;
};

const HowItWorksCard: React.FC<Props> = ({
  title = 'How It Works',
  items,
  containerStyle,
  titleStyle,
  itemStyle,
}) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, containerStyle]}>
      <View style={styles.header}>
        <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
        <Text style={[styles.title, { color: colors.text }, titleStyle]}>{title}</Text>
      </View>

      {items.map((item) => (
        <View key={item} style={styles.row}>
          <Text style={[styles.dot, { color: colors.textMuted }]}>•</Text>
          <Text style={[styles.item, { color: colors.textSecondary }, itemStyle]}>{item}</Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 2,
  },
  dot: {
    marginRight: 6,
    lineHeight: 18,
    fontWeight: '700',
  },
  item: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
});

export default HowItWorksCard;

