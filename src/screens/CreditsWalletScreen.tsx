import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Linking, Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { supabase } from '../config/supabaseClient';

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

  const [buyModalVisible, setBuyModalVisible] = useState(false);
  const [earnModalVisible, setEarnModalVisible] = useState(false);
  const [buyingAmount, setBuyingAmount] = useState<number | null>(null);

  const CREDIT_PACKS = [
    { credits: 50, price: 50, label: 'Starter' },
    { credits: 110, price: 100, label: 'Basic', tag: 'Popular' },
    { credits: 250, price: 200, label: 'Pro', tag: 'Best Value' },
  ];

  const handleBuyCredits = async (priceZAR: number, credits: number) => {
    setBuyingAmount(priceZAR);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert('Sign in required'); return; }
      const { data, error } = await supabase.functions.invoke('payfast-handler', {
        body: {
          type: 'credits',
          amount: priceZAR,
          credits,
          user_id: user.id,
          item_name: `Papzi Credits – ${credits} credits`,
          return_url: 'papzi://credits/success',
          cancel_url: 'papzi://credits/cancel',
          notify_url: 'https://mizdvqhvspkjayffaqqd.supabase.co/functions/v1/payfast-itn',
        },
      });
      if (error || !data?.paymentUrl) {
        Alert.alert('Payment Error', error?.message || 'Unable to start payment.');
        return;
      }
      setBuyModalVisible(false);
      await Linking.openURL(data.paymentUrl);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Something went wrong.');
    } finally {
      setBuyingAmount(null);
    }
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
            onPress={() => setBuyModalVisible(true)}
          >
            <Ionicons name="cash-outline" size={18} color={isDark ? colors.bg : '#fff'} />
            <Text style={[styles.actionText, { color: isDark ? colors.bg : '#fff' }]}>Buy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
            onPress={() => setEarnModalVisible(true)}
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

      {/* Buy Credits Modal */}
      <Modal visible={buyModalVisible} transparent animationType="slide" onRequestClose={() => setBuyModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setBuyModalVisible(false)} />
        <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Buy Credits</Text>
          <Text style={[styles.modalSub, { color: colors.textMuted }]}>Credits are used for tips, PPV unlocks, and live gifts.</Text>
          {CREDIT_PACKS.map(pack => (
            <TouchableOpacity
              key={pack.price}
              style={[styles.packRow, { borderColor: colors.border }]}
              onPress={() => handleBuyCredits(pack.price, pack.credits)}
              disabled={buyingAmount === pack.price}
            >
              <View>
                <Text style={[styles.packLabel, { color: colors.text }]}>{pack.label}</Text>
                <Text style={[styles.packCredits, { color: colors.accent }]}>{pack.credits} Credits</Text>
              </View>
              <View style={styles.packRight}>
                {pack.tag && <Text style={[styles.packTag, { backgroundColor: colors.accent + '22', color: colors.accent }]}>{pack.tag}</Text>}
                <Text style={[styles.packPrice, { color: colors.text }]}>R{pack.price}</Text>
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.border }]} onPress={() => setBuyModalVisible(false)}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Earn Credits Modal */}
      <Modal visible={earnModalVisible} transparent animationType="slide" onRequestClose={() => setEarnModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setEarnModalVisible(false)} />
        <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Earn Credits</Text>
          {[
            { icon: 'person-add', label: 'Refer a friend', desc: 'Earn 20 credits per successful referral' },
            { icon: 'camera', label: 'Complete your first booking', desc: 'Earn 50 credits after your first booking' },
            { icon: 'star', label: 'Leave a review', desc: 'Earn 5 credits after a verified review' },
            { icon: 'share-social', label: 'Share on social media', desc: 'Earn 10 credits for sharing' },
          ].map(item => (
            <View key={item.label} style={[styles.earnRow, { borderColor: colors.border }]}>
              <Ionicons name={item.icon as any} size={22} color={colors.accent} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.packLabel, { color: colors.text }]}>{item.label}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{item.desc}</Text>
              </View>
            </View>
          ))}
          <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.border }]} onPress={() => setEarnModalVisible(false)}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
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
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSub: { fontSize: 13, marginBottom: 8 },
  packRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  packLabel: { fontWeight: '700', fontSize: 15 },
  packCredits: { fontWeight: '800', fontSize: 16, marginTop: 2 },
  packRight: { alignItems: 'flex-end', gap: 4 },
  packTag: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  packPrice: { fontSize: 18, fontWeight: '900' },
  earnRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  closeBtn: { marginTop: 16, padding: 14, borderRadius: 12, alignItems: 'center' },
});

export default CreditsWalletScreen;
