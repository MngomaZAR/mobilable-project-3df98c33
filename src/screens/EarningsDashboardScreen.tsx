import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { fetchCreatorEarnings } from '../services/monetisationService';
import { Earning } from '../types';
import { RootStackParamList } from '../navigation/types';

type Navigation = StackNavigationProp<RootStackParamList, 'EarningsDashboard'>;

export const EarningsDashboardScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { currentUser } = useAppData();
  
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEarnings = React.useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    try {
      const rows = await fetchCreatorEarnings(currentUser.id);
      setEarnings(rows);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      const run = async () => {
        if (!active) return;
        await loadEarnings();
      };
      run();
      const timer = setInterval(run, 20000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [loadEarnings]),
  );

  const totalEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);

  const renderIcon = (type: Earning['source_type']) => {
    switch (type) {
      case 'tip': return <Ionicons name="heart" size={20} color="#ec4899" />;
      case 'subscription': return <Ionicons name="star" size={20} color="#eab308" />;
      case 'video_call': return <Ionicons name="videocam" size={20} color="#3b82f6" />;
      case 'booking': return <Ionicons name="calendar" size={20} color="#10b981" />;
      default: return <Ionicons name="cash" size={20} color="#8b5cf6" />;
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Earnings</Text>
        <TouchableOpacity onPress={() => navigation.navigate('CreatorAnalytics')} style={styles.analyticsBtn}>
          <Ionicons name="stats-chart" size={18} color={colors.text} />
          <Text style={[styles.analyticsBtnText, { color: colors.text }]}>Analytics</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Total Earned</Text>
        <Text style={styles.summaryValue}>R{totalEarnings.toLocaleString()}</Text>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Transaction History</Text>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={earnings}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.row, { borderBottomColor: colors.border }]}>
              <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
                {renderIcon(item.source_type)}
              </View>
              <View style={styles.infoCol}>
                <Text style={[styles.infoTitle, { color: colors.text }]}>
                  {item.source_type.replace('_', ' ').toUpperCase()}
                </Text>
                <Text style={[styles.infoDate, { color: colors.textMuted }]}>
                  {new Date(item.created_at).toLocaleDateString()}
                </Text>
              </View>
              <Text style={[styles.amountTxt, { color: colors.successGreen }]}>
                +R{item.amount.toLocaleString()}
              </Text>
            </View>
          )}
          ListEmptyComponent={<Text style={[styles.empty, { color: colors.textMuted }]}>No earnings yet.</Text>}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  analyticsBtn: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#334155' },
  analyticsBtnText: { fontSize: 12, fontWeight: '700' },
  summaryCard: { backgroundColor: '#1e293b', padding: 24, margin: 16, borderRadius: 20, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 },
  summaryLabel: { color: '#94a3b8', fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  summaryValue: { color: '#fff', fontSize: 40, fontWeight: '900', marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginLeft: 16, marginTop: 10, marginBottom: 8 },
  list: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  infoCol: { flex: 1 },
  infoTitle: { fontWeight: '700', fontSize: 15, marginBottom: 4 },
  infoDate: { fontSize: 13 },
  amountTxt: { fontWeight: '800', fontSize: 16 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 15 },
});

export default EarningsDashboardScreen;
