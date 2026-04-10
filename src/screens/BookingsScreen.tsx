import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { RootStackParamList } from '../navigation/types';
import { Booking } from '../types';
import { Ionicons } from '@expo/vector-icons';
import { PLACEHOLDER_AVATAR } from '../utils/constants';

type Navigation = StackNavigationProp<RootStackParamList, 'BookingDetail'>;

const bookingDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const BookingsScreen: React.FC = () => {
  const { state } = useAppData();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const cardSurface = isDark ? '#141a27' : '#fffaf4';
  const cardShadow = isDark ? '#020611' : '#3f2e1a';

  const providerById = useMemo(
    () => {
      const map = new Map<string, any>();
      state.photographers.forEach(p => map.set(p.id, { ...p, role: 'photographer' }));
      state.models.forEach(m => map.set(m.id, { ...m, role: 'model' }));
      return map;
    },
    [state.photographers, state.models]
  );

  const formatDateTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return bookingDateFormatter.format(date).replace(',', ', ');
  };

  const renderItem = ({ item }: { item: Booking }) => {
    const provider = item.photographer || providerById.get(item.photographer_id || item.model_id || '');
    const providerName = provider?.name ?? provider?.full_name ?? 'Creator';
    const providerRole = provider?.role === 'model' ? 'MODEL' : 'PHOTOGRAPHER';
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: cardSurface, borderColor: colors.border, shadowColor: cardShadow }]}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('BookingDetail', { bookingId: item.id })}
      >
        <Image 
          source={{ uri: provider?.avatar_url || provider?.avatar || PLACEHOLDER_AVATAR }} 
          style={[styles.thumbnail, { backgroundColor: colors.bg }]}
        />
        <View style={styles.cardContent}>
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.package_type}</Text>
          
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>{formatDateTime(item.booking_date)}</Text>
          </View>

          {provider ? (
            <View style={styles.providerRow}>
              <Text style={[styles.providerType, { color: colors.textMuted }]}>{providerRole}</Text>
              <Text style={[styles.providerName, { color: colors.text }]}>{providerName}</Text>
            </View>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={styles.chevron} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: Math.max(24, insets.top + 12) }]}>
      <Text style={[styles.title, { color: colors.text }]}>Your bookings</Text>
      <FlatList
        data={state.bookings}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={[styles.empty, { color: colors.textMuted }]}>No bookings yet. Start one from a profile.</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
    marginBottom: 20,
    marginTop: 4,
    letterSpacing: -0.4,
  },
  listContent: {
    paddingBottom: 112,
    paddingTop: 2,
  },
  card: {
    borderRadius: 24,
    flexDirection: 'row',
    padding: 14,
    minHeight: 118,
    marginBottom: 16,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
    borderWidth: 1,
    alignItems: 'center',
  },
  thumbnail: {
    width: 86,
    height: 86,
    borderRadius: 18,
  },
  cardContent: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
    paddingRight: 8,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 7,
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 7,
    gap: 5,
  },
  metaText: {
    fontSize: 13,
    fontWeight: '600',
  },
  providerRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 1,
  },
  providerType: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  providerName: {
    fontSize: 15,
    fontWeight: '800',
  },
  chevron: {
    marginLeft: 6,
    opacity: 0.7,
  },
  emptyWrap: {
    marginTop: 56,
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  empty: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default BookingsScreen;
