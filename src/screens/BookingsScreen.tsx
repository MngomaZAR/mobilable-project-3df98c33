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

type Navigation = StackNavigationProp<RootStackParamList, 'BookingDetail'>;

const statusColors: Record<Booking['status'], string> = {
  pending: '#f59e0b',
  accepted: '#3b82f6',
  in_progress: '#3b82f6',
  completed: '#10b981',
  reviewed: '#8b5cf6',
  cancelled: '#94a3b8',
  declined: '#ef4444',
};

const BookingsScreen: React.FC = () => {
  const { state } = useAppData();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

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
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  const renderItem = ({ item }: { item: Booking }) => {
    const provider = item.photographer || item.client || providerById.get(item.photographer_id);
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('BookingDetail', { bookingId: item.id })}
      >
        <Image 
          source={{ uri: provider?.avatar_url || provider?.avatar || 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=300&q=80' }} 
          style={[styles.thumbnail, { backgroundColor: colors.bg }]}
        />
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.package_type}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColors[item.status] + '20' }]}>
              <Text style={[styles.statusText, { color: statusColors[item.status] }]}>{item.status}</Text>
            </View>
          </View>
          
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>{formatDateTime(item.booking_date)}</Text>
          </View>

          {provider ? (
            <View style={styles.providerRow}>
              <Text style={[styles.providerType, { color: colors.textMuted }]}>{provider.role === 'model' ? 'Model' : 'Photographer'}</Text>
              <Text style={[styles.providerName, { color: colors.text }]}>{provider.name}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: Math.max(16, insets.top + 8) }]}>
      <Text style={[styles.title, { color: colors.text }]}>Your bookings</Text>
      <FlatList
        data={state.bookings}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={[styles.empty, { color: colors.textMuted }]}>No bookings yet. Start one from a profile.</Text>}
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
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 20,
    marginTop: 8,
  },
  listContent: {
    paddingBottom: 100,
  },
  card: {
    borderRadius: 20,
    flexDirection: 'row',
    padding: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: 1,
  },
  thumbnail: {
    width: 84,
    height: 84,
    borderRadius: 12,
  },
  cardContent: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  metaText: {
    fontSize: 14,
    fontWeight: '500',
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  providerType: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  providerName: {
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    marginTop: 60,
    fontSize: 16,
    fontWeight: '500',
  },
});

export default BookingsScreen;
