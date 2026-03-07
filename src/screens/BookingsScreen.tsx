import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { Booking } from '../types';

type Navigation = StackNavigationProp<RootStackParamList, 'BookingDetail'>;

const statusColors: Record<Booking['status'], string> = {
  pending: '#f59e0b',
  accepted: '#2563eb',
  completed: '#10b981',
  reviewed: '#7c3aed',
};

const BookingsScreen: React.FC = () => {
  const { state } = useAppData();
  const navigation = useNavigation<Navigation>();
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
    const provider = providerById.get(item.photographerId);
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('BookingDetail', { bookingId: item.id })}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.package}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColors[item.status] }]}>
            <Text style={styles.statusText}>{item.status}</Text>
          </View>
        </View>
        <Text style={styles.meta}>{formatDateTime(item.date)}</Text>
        {provider ? (
          <Text style={styles.meta}>
            {provider.role === 'model' ? 'Model' : 'Photographer'}: {provider.name}
          </Text>
        ) : null}
        <Text style={styles.meta}>Created {new Date(item.createdAt).toLocaleDateString()}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your bookings</Text>
      <FlatList
        data={state.bookings}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No bookings yet. Start one from a profile.</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7fb',
    padding: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 10,
  },
  listContent: {
    paddingBottom: 100,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  meta: {
    color: '#475569',
    marginTop: 4,
  },
  empty: {
    marginTop: 24,
    textAlign: 'center',
    color: '#475569',
  },
});

export default BookingsScreen;
