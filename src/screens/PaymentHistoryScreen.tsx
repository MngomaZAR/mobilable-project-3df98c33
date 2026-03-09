import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { fetchMyPayments, PaymentRow } from '../services/paymentHistoryService';

const statusColor = (status: PaymentRow['status']) => {
  switch (status) {
    case 'completed': return '#22c55e';
    case 'failed': return '#ef4444';
    case 'cancelled': return '#f59e0b';
    default: return '#94a3b8';
  }
};

const PaymentHistoryScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { state } = useAppData();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyPayments();
      setPayments(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPayments(); }, [loadPayments]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Payment History</Text>
      </View>

      {loading && payments.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={payments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={loadPayments} />}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.row}>
                <View style={styles.iconBox}>
                  <Ionicons name="card-outline" size={22} color={colors.accent} />
                </View>
                <View style={styles.info}>
                  <Text style={[styles.desc, { color: colors.text }]}>{item.description}</Text>
                  <Text style={[styles.date, { color: colors.textMuted }]}>
                    {new Date(item.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
                <View style={styles.amountCol}>
                  <Text style={[styles.amount, { color: colors.text }]}>
                    R{item.amount.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + '22' }]}>
                    <Text style={[styles.statusTxt, { color: statusColor(item.status) }]}>
                      {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyTxt, { color: colors.textMuted }]}>No payments yet</Text>
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  desc: { fontWeight: '700', fontSize: 14 },
  date: { fontSize: 12, marginTop: 2 },
  amountCol: { alignItems: 'flex-end', gap: 4 },
  amount: { fontWeight: '800', fontSize: 16 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusTxt: { fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyTxt: { fontSize: 16 },
});

export default PaymentHistoryScreen;
