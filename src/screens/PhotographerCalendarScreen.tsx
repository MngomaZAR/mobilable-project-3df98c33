import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useAppData } from '../store/AppDataContext';

const PhotographerCalendarScreen: React.FC = () => {
  const { state, currentUser } = useAppData();
  const upcoming = useMemo(
    () =>
      state.bookings
        .filter(
          (booking) =>
            booking.photographerId === currentUser?.id &&
            booking.status !== 'reviewed'
        )
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [currentUser?.id, state.bookings]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Calendar</Text>
      <FlatList
        data={upcoming}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.package}
            </Text>
            <Text style={styles.cardMeta}>{item.date}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No upcoming shoots yet.</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7fb', padding: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 10 },
  listContent: { paddingBottom: 80 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: { color: '#0f172a', fontWeight: '700' },
  cardMeta: { color: '#475569', marginTop: 4 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 24 },
});

export default PhotographerCalendarScreen;
