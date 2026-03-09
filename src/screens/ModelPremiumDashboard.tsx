import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Image, Dimensions, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../store/AuthContext';
import { useBooking } from '../store/BookingContext';
import { RootStackParamList } from '../navigation/types';
import { LinearGradient } from 'expo-linear-gradient';
import CreatePremiumBox from './CreatePremiumBox';

const { width } = Dimensions.get('window');

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const ModelPremiumDashboard: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { currentUser } = useAuth();
  const { bookings } = useBooking();
  const [showPremiumBox, setShowPremiumBox] = React.useState(false);

  const earnings = useMemo(() => {
    const completed = bookings.filter(b => b.status === 'completed' || b.status === 'accepted');
    const net = completed.reduce((sum, b) => sum + (b.payout_amount || 0), 0);
    return { net, activeSubscribers: 124, tipsThisMonth: 8500 };
  }, [bookings]);

  const recentInteraction = bookings[0];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity 
              onPress={() => navigation.goBack()}
              style={{ marginRight: 12, padding: 4 }}
            >
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </TouchableOpacity>
            <View>
              <Text style={styles.greeting}>Elite Creator Dashboard</Text>
              <Text style={styles.title}>Welcome back, {currentUser?.full_name || 'Creator'}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.profileBadge}>
            <Image 
              source={{ uri: currentUser?.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200' }} 
              style={styles.avatar} 
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => navigation.navigate('EarningsDashboard')}
        >
          <LinearGradient
            colors={['#8b5cf6', '#ec4899']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View>
              <Text style={styles.heroLabel}>Net Earnings</Text>
              <Text style={styles.heroValue}>R{earnings.net.toLocaleString()}</Text>
              <View style={styles.heroStats}>
                <View style={styles.hStat}>
                  <Text style={styles.hStatVal}>{earnings.activeSubscribers}</Text>
                  <Text style={styles.hStatLabel}>Subscribers</Text>
                </View>
                <View style={styles.hStat}>
                  <Text style={styles.hStatVal}>R{earnings.tipsThisMonth.toLocaleString()}</Text>
                  <Text style={styles.hStatLabel}>Tips (MTD)</Text>
                </View>
              </View>
            </View>
            <View style={styles.heroAction}>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </View>
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.quickActions}>
          <TouchableOpacity 
            style={styles.actionBtn}
            onPress={() => navigation.navigate('PaidVideoCall')}
          >
            <View style={[styles.iconWrap, { backgroundColor: '#fdf2f8' }]}>
              <Ionicons name="videocam" size={24} color="#db2777" />
            </View>
            <Text style={styles.actionLabel}>Paid Call</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionBtn}
            onPress={() => setShowPremiumBox(true)}
          >
            <View style={[styles.iconWrap, { backgroundColor: '#f5f3ff' }]}>
              <Ionicons name="add-circle" size={24} color="#7c3aed" />
            </View>
            <Text style={styles.actionLabel}>Post Content</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionBtn}
            onPress={() => Alert.alert('Go Live', 'Live streaming is a premium feature. Apply for Elite Gold to unlock.')}
          >
            <View style={[styles.iconWrap, { backgroundColor: '#ecfdf5' }]}>
              <Ionicons name="radio" size={24} color="#059669" />
            </View>
            <Text style={styles.actionLabel}>Go Live</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionBtn}
            onPress={() => navigation.navigate('Root', { screen: 'Chat' })}
          >
            <View style={[styles.iconWrap, { backgroundColor: '#fff7ed' }]}>
              <Ionicons name="chatbubbles" size={24} color="#ea580c" />
            </View>
            <Text style={styles.actionLabel}>Messages</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Active Engagements</Text>
            <TouchableOpacity><Text style={styles.viewAll}>View History</Text></TouchableOpacity>
          </View>
          
          {recentInteraction ? (
            <TouchableOpacity style={styles.engagementCard}>
              <View style={styles.engMeta}>
                <Ionicons name="time-outline" size={16} color="#64748b" />
                <Text style={styles.engTime}>Starting in 15 mins</Text>
              </View>
              <Text style={styles.engTitle}>Video Consultation: {recentInteraction.package_type}</Text>
              <View style={styles.engClientRow}>
                <View style={styles.clientInfo}>
                  <View style={styles.clientAvatarPlace} />
                  <Text style={styles.clientName}>Private Client</Text>
                </View>
                <TouchableOpacity 
                  style={styles.joinBtn}
                  onPress={() => navigation.navigate('PaidVideoCall')}
                >
                  <Text style={styles.joinBtnText}>Join Room</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ) : (
            <Text style={styles.empty}>No active bookings yet.</Text>
          )}
        </View>

        <View style={styles.premiumCard}>
          <Ionicons name="diamond" size={32} color="#fbbf24" />
          <View style={styles.premiumText}>
            <Text style={styles.premiumTitle}>Upgrade to Elite Gold</Text>
            <Text style={styles.premiumSubtitle}>Lower fees (15%) and verified badge.</Text>
          </View>
          <TouchableOpacity style={styles.premiumBtn}>
            <Text style={styles.premiumBtnText}>Apply</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      <CreatePremiumBox 
        visible={showPremiumBox} 
        onClose={() => setShowPremiumBox(false)} 
        onSuccess={() => setShowPremiumBox(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  container: { padding: 20, paddingBottom: 100 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  greeting: { color: '#8b5cf6', fontWeight: '800', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
  title: { color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 4 },
  profileBadge: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', borderWidth: 2, borderColor: '#ec4899' },
  avatar: { width: '100%', height: '100%' },
  heroCard: {
    padding: 24,
    borderRadius: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#ec4899',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
  },
  heroLabel: { color: 'rgba(255,255,255,0.8)', fontWeight: '700', fontSize: 14 },
  heroValue: { color: '#fff', fontSize: 32, fontWeight: '900', marginTop: 4 },
  heroStats: { flexDirection: 'row', marginTop: 16, gap: 20 },
  hStat: {
    alignItems: 'flex-start',
  },
  hStatVal: { color: '#fff', fontWeight: '800', fontSize: 16 },
  hStatLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  heroAction: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  actionBtn: { alignItems: 'center', width: (width - 40) / 4.2 },
  iconWrap: { width: 50, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  actionLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  viewAll: { color: '#8b5cf6', fontWeight: '700' },
  engagementCard: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  engMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  engTime: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  engTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 16 },
  engClientRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clientInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  clientAvatarPlace: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#334155' },
  clientName: { color: '#cbd5e1', fontWeight: '700' },
  joinBtn: { backgroundColor: '#8b5cf6', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  joinBtnText: { color: '#fff', fontWeight: '800' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 10 },
  premiumCard: {
    backgroundColor: '#171717',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#262626',
  },
  premiumText: { flex: 1, marginLeft: 16 },
  premiumTitle: { color: '#fbbf24', fontWeight: '900', fontSize: 16 },
  premiumSubtitle: { color: '#737373', fontSize: 13, marginTop: 2 },
  premiumBtn: { backgroundColor: '#262626', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  premiumBtnText: { color: '#fff', fontWeight: '700' },
});

export default ModelPremiumDashboard;
