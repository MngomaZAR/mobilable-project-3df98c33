import React, { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';

const CreditsWalletScreen: React.FC = () => {
  const { colors, isDark } = useTheme();
  const { state, fetchCredits, redeemCreditsCode } = useAppData();
  const [loading, setLoading] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await fetchCredits(state.currentUser?.id ?? null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fetchCredits, state.currentUser?.id]);

  const balance = state.creditsWallet?.balance ?? 0;

  const handleComingSoon = (title: string) => {
    Alert.alert(title, 'Credits purchases and rewards are rolling out soon.');
  };

  const handleRedeem = async () => {
    if (!redeemCode.trim()) {
      Alert.alert('Code required', 'Enter a promo code to redeem credits.');
      return;
    }
    try {
      setRedeeming(true);
      await redeemCreditsCode(redeemCode.trim());
      setRedeemCode('');
      Alert.alert('Success', 'Credits added to your wallet.');
    } catch (err: any) {
      Alert.alert('Unable to redeem', err?.message ?? 'Invalid or expired code.');
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Papzi Credits</Text>
        <Text style={[styles.balance, { color: colors.text }]}>{balance.toLocaleString('en-ZA')}</Text>
        <Text style={[styles.sub, { color: colors.textMuted }]}>
          Use credits for tips, unlocks, and live gifts.
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.accent }]}
            onPress={() => handleComingSoon('Buy Credits')}
          >
            <Ionicons name="cash-outline" size={18} color={isDark ? colors.bg : '#fff'} />
            <Text style={[styles.actionText, { color: isDark ? colors.bg : '#fff' }]}>Buy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
            onPress={() => handleComingSoon('Earn Credits')}
          >
            <Ionicons name="gift-outline" size={18} color={colors.text} />
            <Text style={[styles.actionText, { color: colors.text }]}>Earn</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.redeemRow}>
          <TextInput
            value={redeemCode}
            onChangeText={setRedeemCode}
            placeholder="Promo code"
            placeholderTextColor={colors.textMuted}
            style={[styles.redeemInput, { color: colors.text, borderColor: colors.border }]}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={[styles.redeemBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleRedeem}
            disabled={redeeming}
          >
            <Text style={[styles.redeemText, { color: colors.text }]}>
              {redeeming ? '...' : 'Redeem'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent activity</Text>
        {loading ? <Text style={{ color: colors.textMuted }}>Updating…</Text> : null}
      </View>

      <FlatList
        data={state.creditsLedger}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="wallet-outline" size={36} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              No credit activity yet.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderColor: colors.border }]}>
            <View style={styles.rowLeft}>
              <Ionicons
                name={item.direction === 'credit' ? 'arrow-down-circle' : 'arrow-up-circle'}
                size={20}
                color={item.direction === 'credit' ? '#10b981' : '#ef4444'}
              />
              <View style={{ marginLeft: 10 }}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>
                  {item.reason ?? (item.direction === 'credit' ? 'Credit added' : 'Credit spent')}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
                  {new Date(item.created_at).toLocaleString()}
                </Text>
              </View>
            </View>
            <Text style={[styles.rowAmount, { color: item.direction === 'credit' ? '#10b981' : '#ef4444' }]}>
              {item.direction === 'credit' ? '+' : '-'}{item.amount}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  balance: { fontSize: 32, fontWeight: '900', marginTop: 6 },
  sub: { marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  actionText: { fontWeight: '800' },
  redeemRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  redeemInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  redeemBtn: { paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center', borderWidth: 1 },
  redeemText: { fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLeft: { flexDirection: 'row', alignItems: 'center' },
  rowTitle: { fontWeight: '700' },
  rowMeta: { fontSize: 12, marginTop: 2 },
  rowAmount: { fontWeight: '800' },
  empty: { alignItems: 'center', padding: 24, gap: 10 },
  emptyText: { textAlign: 'center' },
});

export default CreditsWalletScreen;
