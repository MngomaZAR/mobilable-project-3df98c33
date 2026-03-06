import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const AdminDashboardScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state } = useAppData();

  const pendingBookings = useMemo(
    () => state.bookings.filter((booking) => booking.status === 'pending').length,
    [state.bookings]
  );
  const completedBookings = useMemo(
    () => state.bookings.filter((booking) => booking.status === 'completed').length,
    [state.bookings]
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Admin operations</Text>
          <Text style={styles.title}>Papzi control center</Text>
          <Text style={styles.subtitle}>Review marketplace health, orders, and user activity.</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Pending bookings</Text>
            <Text style={styles.statValue}>{pendingBookings}</Text>
            <Text style={styles.statMeta}>Needs ops follow-up</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Completed jobs</Text>
            <Text style={styles.statValue}>{completedBookings}</Text>
            <Text style={styles.statMeta}>Settled and delivered</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Moderation queue</Text>
          <Text style={styles.cardBody}>
            Use feed and chat tools to review content reports and resolve disputes quickly.
          </Text>
          <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('Root', { screen: 'Feed' })}>
            <Ionicons name="images-outline" size={18} color="#0f172a" />
            <Text style={styles.actionText}>Review feed activity</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('Root', { screen: 'Chat' })}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#0f172a" />
            <Text style={styles.actionText}>Review active chats</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Payments and compliance</Text>
          <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('Root', { screen: 'Bookings' })}>
            <Ionicons name="card-outline" size={18} color="#0f172a" />
            <Text style={styles.actionText}>Inspect booking and payment states</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('Compliance')}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#0f172a" />
            <Text style={styles.actionText}>Open compliance settings</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f7f7fb' },
  container: { padding: 16, paddingBottom: 120 },
  hero: { marginBottom: 14 },
  eyebrow: { color: '#2563eb', fontWeight: '800', marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '800', color: '#0f172a' },
  subtitle: { color: '#475569', marginTop: 4 },
  statsRow: { flexDirection: 'row', marginBottom: 14 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginRight: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  statLabel: { color: '#475569', fontWeight: '700' },
  statValue: { fontSize: 24, fontWeight: '800', color: '#0f172a' },
  statMeta: { color: '#64748b', marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    marginBottom: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  cardBody: { color: '#475569', marginBottom: 10 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#dbe3f2',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    backgroundColor: '#f8fafc',
  },
  actionText: { color: '#0f172a', fontWeight: '700' },
});

export default AdminDashboardScreen;

