import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { supabase } from '../config/supabaseClient';

type PayoutMethod = {
  id: string;
  bank_name: string;
  account_holder: string;
  account_masked: string;
  account_type: 'cheque' | 'savings' | 'current';
  branch_code: string | null;
  is_default: boolean;
  verified: boolean;
};

const PayoutMethodsScreen: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAppData();
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [accountType, setAccountType] = useState<'cheque' | 'savings' | 'current'>('cheque');

  const fetchMethods = useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('payout-methods', { body: { action: 'list' } });
      if (error) throw error;
      setMethods((data?.methods ?? []) as PayoutMethod[]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not load payout methods.');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    fetchMethods();
  }, [fetchMethods]);

  const addMethod = async () => {
    if (!currentUser?.id) return;
    if (!bankName.trim() || !accountHolder.trim() || !accountNumber.trim()) {
      Alert.alert('Missing details', 'Bank name, account holder and account number are required.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke('payout-methods', {
        body: {
          action: 'add',
          bank_name: bankName.trim(),
          account_holder: accountHolder.trim(),
          account_number: accountNumber.trim(),
          account_type: accountType,
          branch_code: branchCode.trim() || null,
        },
      });
      if (error) throw error;
      setBankName('');
      setAccountHolder('');
      setAccountNumber('');
      setBranchCode('');
      await fetchMethods();
      Alert.alert('Saved', 'Payout method added.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not save payout method.');
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (id: string) => {
    if (!currentUser?.id) return;
    try {
      const { error } = await supabase.functions.invoke('payout-methods', { body: { action: 'set_default', id } });
      if (error) throw error;
      await fetchMethods();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not update default payout method.');
    }
  };

  const removeMethod = async (id: string) => {
    Alert.alert(
      'Remove payout method',
      'This will remove the bank account from your payout options.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.functions.invoke('payout-methods', { body: { action: 'delete', id } });
              if (error) throw error;
              await fetchMethods();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Could not remove payout method.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: Math.max(12, insets.top + 4), paddingBottom: Math.max(40, insets.bottom + 20) }]}>
        <Text style={[styles.title, { color: colors.text }]}>Payout Methods</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Add your bank details for creator payouts. Verification is handled by admin review.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            value={bankName}
            onChangeText={setBankName}
            placeholder="Bank name"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
          />
          <TextInput
            value={accountHolder}
            onChangeText={setAccountHolder}
            placeholder="Account holder"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
          />
          <TextInput
            value={accountNumber}
            onChangeText={(v) => setAccountNumber(v.replace(/[^\d]/g, ''))}
            placeholder="Account number"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
          />
          <TextInput
            value={branchCode}
            onChangeText={setBranchCode}
            placeholder="Branch code (optional)"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
          />
          <View style={styles.typesRow}>
            {(['cheque', 'savings', 'current'] as const).map((type) => (
              <TouchableOpacity
                key={type}
                onPress={() => setAccountType(type)}
                style={[styles.typeChip, { borderColor: colors.border, backgroundColor: accountType === type ? colors.accent + '22' : colors.bg }]}
              >
                <Text style={{ color: accountType === type ? colors.text : colors.textMuted, fontWeight: '700', textTransform: 'capitalize' }}>{type}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={addMethod} disabled={saving} style={[styles.addBtn, { backgroundColor: colors.accent }]}>
            <Text style={styles.addBtnText}>{saving ? 'Saving...' : 'Add Payout Method'}</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />
        ) : (
          methods.map((method) => (
            <View key={method.id} style={[styles.methodCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.methodHeader}>
                <Text style={[styles.methodTitle, { color: colors.text }]}>{method.bank_name}</Text>
                {method.verified ? (
                  <Text style={[styles.badge, { color: '#16a34a' }]}>Verified</Text>
                ) : (
                  <Text style={[styles.badge, { color: '#f59e0b' }]}>Pending review</Text>
                )}
              </View>
              <Text style={[styles.methodMeta, { color: colors.textSecondary }]}>{method.account_holder}</Text>
              <Text style={[styles.methodMeta, { color: colors.textMuted }]}>{method.account_masked} · {method.account_type}</Text>
              <View style={styles.methodActions}>
                {!method.is_default && (
                  <TouchableOpacity onPress={() => setDefault(method.id)} style={[styles.smallBtn, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Set Default</Text>
                  </TouchableOpacity>
                )}
                {method.is_default && (
                  <View style={[styles.defaultPill, { backgroundColor: colors.accent + '22' }]}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.accent} />
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Default</Text>
                  </View>
                )}
                <TouchableOpacity onPress={() => removeMethod(method.id)} style={[styles.smallBtn, { borderColor: '#ef4444' }]}>
                  <Text style={{ color: '#ef4444', fontWeight: '700' }}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { padding: 16, gap: 12 },
  title: { fontSize: 24, fontWeight: '900' },
  subtitle: { fontSize: 14, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  typesRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  typeChip: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  addBtn: { borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 46, marginTop: 4 },
  addBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  methodCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  methodHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  methodTitle: { fontSize: 16, fontWeight: '800' },
  methodMeta: { fontSize: 13 },
  badge: { fontSize: 12, fontWeight: '800' },
  methodActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  smallBtn: { borderWidth: 1, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10 },
  defaultPill: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
});

export default PayoutMethodsScreen;
