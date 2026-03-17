import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LineChart, PieChart } from 'react-native-chart-kit';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useBooking } from '../store/BookingContext';

const { width } = Dimensions.get('window');
type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const CreatorAnalyticsScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state } = useAppData();
  const { bookings } = useBooking();
  const [period, setPeriod] = useState<'7d' | '30d' | 'all'>('30d');

  const earnings = useMemo(() => {
    const earningRows = state.earnings ?? [];
    
    const tipTotal = earningRows
      .filter((e: any) => e.source_type === 'tip')
      .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
      
    const subTotal = earningRows
      .filter((e: any) => e.source_type === 'subscription')
      .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
      
    const bookingTotal = bookings
      .filter(b => b.status === 'completed' || b.status === 'accepted')
      .reduce((s, b) => s + (b.payout_amount || 0), 0);

    const net = bookingTotal + tipTotal + subTotal;

    return { net, tipTotal, subTotal, bookingTotal };
  }, [bookings, state.earnings]);

  const pieData = [
    { name: 'Bookings', amount: earnings.bookingTotal, color: '#ec4899', legendFontColor: '#94a3b8', legendFontSize: 12 },
    { name: 'Tips', amount: earnings.tipTotal, color: '#8b5cf6', legendFontColor: '#94a3b8', legendFontSize: 12 },
    { name: 'Subs', amount: earnings.subTotal, color: '#0ea5e9', legendFontColor: '#94a3b8', legendFontSize: 12 },
  ].filter(d => d.amount > 0);

  // Mock line chart data
  const lineData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        data: [200, 450, 280, 800, 990, 430, 1100],
        color: (opacity = 1) => `rgba(236, 72, 153, ${opacity})`, // ec4899
        strokeWidth: 3
      }
    ],
  };

  return (
    <SafeAreaView style={s.safeArea}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Analytics Dashboard</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        
        {/* Period Selector */}
        <View style={s.periodTabs}>
          {(['7d', '30d', 'all'] as const).map(p => (
            <TouchableOpacity 
              key={p} 
              style={[s.periodTab, period === p && s.periodTabActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[s.periodTabText, period === p && s.periodTabTextActive]}>
                {p === '7d' ? 'Last 7 Days' : p === '30d' ? 'Last 30 Days' : 'All Time'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Overview Stats */}
        <View style={s.statsGrid}>
           <View style={s.statCard}>
             <Ionicons name="wallet" size={20} color="#ec4899" />
             <Text style={s.statLabel}>Net Revenue</Text>
             <Text style={s.statValue}>R{earnings.net.toLocaleString('en-ZA')}</Text>
             <Text style={s.statTrendPos}>+12.5% vs last period</Text>
           </View>
           <View style={s.statCard}>
             <Ionicons name="eye" size={20} color="#8b5cf6" />
             <Text style={s.statLabel}>Profile Views</Text>
             <Text style={s.statValue}>4,521</Text>
             <Text style={s.statTrendNeg}>-2.4% vs last period</Text>
           </View>
        </View>

        {/* Line Chart */}
        <View style={s.chartCard}>
          <Text style={s.chartTitle}>Revenue Over Time</Text>
          <LineChart
            data={lineData}
            width={width - 64}
            height={220}
            chartConfig={{
              backgroundColor: '#1e293b',
              backgroundGradientFrom: '#1e293b',
              backgroundGradientTo: '#1e293b',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(148, 163, 184, ${opacity})`,
              style: { borderRadius: 16 },
              propsForDots: { r: "4", strokeWidth: "2", stroke: "#ec4899" }
            }}
            bezier
            style={{ marginVertical: 8, borderRadius: 16 }}
            yAxisLabel="R"
          />
        </View>

        {/* Revenue Sources Pie Chart */}
        <View style={s.chartCard}>
          <Text style={s.chartTitle}>Earnings Breakdown</Text>
          {pieData.length > 0 ? (
            <PieChart
              data={pieData}
              width={width - 64}
              height={200}
              chartConfig={{ color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})` }}
              accessor={"amount"}
              backgroundColor={"transparent"}
              paddingLeft={"15"}
              absolute
            />
          ) : (
            <Text style={s.emptyText}>Not enough data to generate chart.</Text>
          )}
        </View>

        {/* Funnel Metrics */}
        <View style={s.funnelCard}>
          <Text style={s.chartTitle}>Conversion Funnel</Text>
          <View style={s.funnelRow}>
             <Text style={s.funnelLabel}>Profile Visitors</Text>
             <Text style={s.funnelVal}>4,521</Text>
          </View>
          <View style={s.funnelRow}>
             <Text style={s.funnelLabel}>Interacted (Liked/Messaged)</Text>
             <Text style={s.funnelVal}>842 <Text style={s.funnelPct}>(18%)</Text></Text>
          </View>
          <View style={[s.funnelRow, { borderBottomWidth: 0 }]}>
             <Text style={s.funnelLabel}>Converted to Paying</Text>
             <Text style={[s.funnelVal, { color: '#10b981' }]}>115 <Text style={s.funnelPct}>(2.5%)</Text></Text>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a14' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 60 },
  periodTabs: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 12, padding: 4, marginBottom: 20 },
  periodTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  periodTabActive: { backgroundColor: '#334155' },
  periodTabText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  periodTabTextActive: { color: '#fff', fontWeight: '800' },
  statsGrid: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: '#1e293b', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#334155' },
  statLabel: { color: '#94a3b8', fontSize: 12, marginTop: 12, marginBottom: 4 },
  statValue: { color: '#fff', fontSize: 24, fontWeight: '900' },
  statTrendPos: { color: '#10b981', fontSize: 11, marginTop: 6, fontWeight: '600' },
  statTrendNeg: { color: '#ef4444', fontSize: 11, marginTop: 6, fontWeight: '600' },
  chartCard: { backgroundColor: '#1e293b', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#334155', marginBottom: 20 },
  chartTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 16 },
  emptyText: { color: '#64748b', textAlign: 'center', paddingVertical: 40 },
  funnelCard: { backgroundColor: '#1e293b', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#334155' },
  funnelRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#334155' },
  funnelLabel: { color: '#cbd5e1', fontSize: 14 },
  funnelVal: { color: '#fff', fontWeight: '800', fontSize: 14 },
  funnelPct: { color: '#64748b', fontSize: 12, fontWeight: '600' },
});

export default CreatorAnalyticsScreen;
