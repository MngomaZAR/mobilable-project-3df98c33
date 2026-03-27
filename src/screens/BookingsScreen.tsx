import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { RootStackParamList } from '../navigation/types';
import { Booking } from '../types';
import { Ionicons } from '@expo/vector-icons';

type Navigation = StackNavigationProp<RootStackParamList, 'BookingDetail'>;
const SEEDED_KEY_PREFIX = 'papzi-bookings-seeded';

const statusColors: Record<Booking['status'], string> = {
  pending: '#f59e0b',
  accepted: '#3b82f6',
  in_progress: '#3b82f6',
  completed: '#10b981',
  reviewed: '#8b5cf6',
  cancelled: '#94a3b8',
  declined: '#ef4444',
  paid_out: '#10b981',
};

const bookingDateFormatter = new Intl.DateTimeFormat('en-ZA', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const toStatusLabel = (status: Booking['status']) => status.replace(/_/g, ' ').toUpperCase();

const BookingsScreen: React.FC = () => {
  const { state, createBooking, refresh } = useAppData();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const cardSurface = isDark ? 'rgba(18, 27, 47, 0.94)' : '#fffaf2';
  const cardShadow = isDark ? '#050910' : '#1f1710';
  const [seeding, setSeeding] = useState(false);
  const [autoSeedChecked, setAutoSeedChecked] = useState(false);

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

  const seedSampleBookings = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!state.currentUser?.id) {
      if (!silent) {
        Alert.alert('Sign in required', 'Please sign in before seeding sample bookings.');
      }
      return false;
    }
    if (seeding) return false;
    if (state.bookings.length > 0) return true;

    const providerByName = new Map<string, { id: string; type: 'photographer' | 'model'; name: string }>();
    state.photographers.forEach((p) => providerByName.set(p.name, { id: p.id, type: 'photographer', name: p.name }));
    state.models.forEach((m) => providerByName.set(m.name, { id: m.id, type: 'model', name: m.name }));

    const referenceBookings = [
      { name: 'Lerato Sithole', type: 'photographer' as const, package_type: 'Your bookings', date: '2026-03-24T02:00:00+02:00' },
      { name: 'Sipho Dlamini', type: 'photographer' as const, package_type: 'Half-day coverage', date: '2026-04-15T02:00:00+02:00' },
      { name: 'Sipho Dlamini', type: 'photographer' as const, package_type: 'Half-day coverage', date: '2026-03-10T02:00:00+02:00' },
      { name: 'Sipho Dlamini', type: 'photographer' as const, package_type: 'Half-day coverage', date: '2026-03-19T02:00:00+02:00' },
    ];

    const referenceProviders = referenceBookings
      .map((entry) => {
        const provider = providerByName.get(entry.name);
        return provider ? { ...provider, package_type: entry.package_type, date: entry.date } : null;
      })
      .filter(Boolean) as Array<{ id: string; type: 'photographer' | 'model'; name: string; package_type: string; date: string }>;

    const fallbackProviders = [
      ...state.photographers.slice(0, 3).map((p) => ({ id: p.id, type: 'photographer' as const, name: p.name, package_type: 'Half-day coverage', date: null })),
      ...state.models.slice(0, 1).map((m) => ({ id: m.id, type: 'model' as const, name: m.name, package_type: 'Half-day coverage', date: null })),
    ];

    const providers = referenceProviders.length > 0 ? referenceProviders : fallbackProviders;

    if (providers.length === 0) {
      if (!silent) {
        Alert.alert('No providers found', 'Could not find providers to create sample bookings.');
      }
      return false;
    }

    setSeeding(true);
    try {
      const now = new Date();
      for (let i = 0; i < providers.length; i += 1) {
        const provider = providers[i];
        const start = provider.date ? new Date(provider.date) : new Date(now.getTime() + (24 + i * 3) * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        await createBooking({
          talent_id: provider.id,
          talent_type: provider.type,
          booking_date: start.toISOString(),
          start_datetime: start.toISOString(),
          end_datetime: end.toISOString(),
          package_type: provider.package_type,
          notes: `Sample booking with ${provider.name}`,
          base_amount: 1200 + i * 250,
          travel_amount: 100 + i * 50,
          latitude: -33.9249,
          longitude: 18.4241,
          fanout_count: 1,
          intensity_level: 1,
        });
      }
      await refresh();
      if (!silent) {
        Alert.alert('Sample bookings added', 'Bookings list has been populated.');
      }
      return true;
    } catch (error: any) {
      if (!silent) {
        Alert.alert('Seeding failed', error?.message || 'Could not seed bookings.');
      }
      return false;
    } finally {
      setSeeding(false);
    }
  }, [createBooking, refresh, seeding, state.bookings.length, state.currentUser?.id, state.models, state.photographers]);

  useEffect(() => {
    let active = true;
    const maybeAutoSeed = async () => {
      if (!state.currentUser?.id || autoSeedChecked) return;
      if (state.currentUser.role !== 'client') {
        if (active) setAutoSeedChecked(true);
        return;
      }
      if (state.bookings.length > 0) {
        if (active) setAutoSeedChecked(true);
        return;
      }

      const key = `${SEEDED_KEY_PREFIX}:${state.currentUser.id}`;
      const seededAlready = await AsyncStorage.getItem(key);
      if (seededAlready === '1') {
        if (active) setAutoSeedChecked(true);
        return;
      }

      const seeded = await seedSampleBookings({ silent: true });
      if (seeded) {
        await AsyncStorage.setItem(key, '1');
      }
      if (active) setAutoSeedChecked(true);
    };

    maybeAutoSeed().catch(() => {
      if (active) setAutoSeedChecked(true);
    });
    return () => {
      active = false;
    };
  }, [autoSeedChecked, seedSampleBookings, state.bookings.length, state.currentUser?.id, state.currentUser?.role]);

  const renderItem = ({ item }: { item: Booking }) => {
    const provider = item.photographer || item.client || providerById.get(item.photographer_id);
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: cardSurface, borderColor: colors.border, shadowColor: cardShadow }]}
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
              <Text style={[styles.statusText, { color: statusColors[item.status] }]}>{toStatusLabel(item.status)}</Text>
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
            <TouchableOpacity
              style={[styles.seedBtn, { backgroundColor: colors.accent }]}
              onPress={() => { void seedSampleBookings(); }}
              disabled={seeding}
            >
              <Ionicons name={seeding ? 'hourglass-outline' : 'sparkles-outline'} size={16} color={isDark ? colors.bg : '#fffaf2'} />
              <Text style={[styles.seedBtnText, { color: isDark ? colors.bg : '#fffaf2' }]}>
                {seeding ? 'Seeding...' : 'Seed sample bookings'}
              </Text>
            </TouchableOpacity>
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
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    marginBottom: 18,
    marginTop: 2,
  },
  listContent: {
    paddingBottom: 112,
  },
  card: {
    borderRadius: 26,
    flexDirection: 'row',
    padding: 14,
    minHeight: 128,
    marginBottom: 16,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
    borderWidth: 1,
    alignItems: 'center',
  },
  thumbnail: {
    width: 104,
    height: 104,
    borderRadius: 20,
  },
  cardContent: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
    paddingRight: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 21,
    fontWeight: '800',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  metaText: {
    fontSize: 16,
    fontWeight: '600',
  },
  providerRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 1,
  },
  providerType: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  providerName: {
    fontSize: 16,
    fontWeight: '700',
  },
  chevron: {
    marginLeft: 6,
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
  seedBtn: {
    marginTop: 14,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  seedBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },
});

export default BookingsScreen;
