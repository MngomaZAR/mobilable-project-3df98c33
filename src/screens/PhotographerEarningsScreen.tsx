import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useAppData } from '../store/AppDataContext';
import { formatCurrency, getCurrencyForLocale } from '../utils/format';

const PhotographerEarningsScreen: React.FC = () => {
  const { state, currentUser } = useAppData();
  const currency = useMemo(() => getCurrencyForLocale(), []);
  const rows = useMemo(
    () => state.bookings.filter((booking) => booking.photographerId === currentUser?.id),
    [currentUser?.id, state.bookings]
  );
  const totals = useMemo(() => {
    const gross = rows.reduce((sum, booking) => sum + (booking.priceTotal ?? 0), 0);
    const payout = gross * 0.7;
    return { gross, payout };
  }, [rows]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Earnings</Text>
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Gross booked</Text>
          <Text style={styles.statValue}>{formatCurrency(totals.gross, currency)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Est. payout</Text>
          <Text style={styles.statValue}>{formatCurrency(totals.payout, currency)}</Text>
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.package}
            </Text>
            <Text style={styles.cardMeta}>
              {formatCurrency(item.priceTotal ?? 0, item.currency ?? currency)} · {item.status}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No earnings data yet.</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7fb', padding: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 10 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    padding: 12,
  },
  statLabel: { color: '#64748b', fontWeight: '600' },
  statValue: { color: '#0f172a', fontWeight: '800', fontSize: 18, marginTop: 4 },
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

export default PhotographerEarningsScreen;
