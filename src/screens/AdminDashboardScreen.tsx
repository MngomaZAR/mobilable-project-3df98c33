import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { useMessaging } from '../store/MessagingContext';
import { NewMessageModal } from '../components/NewMessageModal';

type Navigation = StackNavigationProp<RootStackParamList>;

const AdminDashboardScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state } = useAppData();
  const { startConversationWithUser } = useMessaging();
  const [showNewMessage, setShowNewMessage] = React.useState(false);
  const { colors, isDark } = useTheme();

  const pendingBookings = useMemo(
    () => state.bookings.filter((booking) => booking.status === 'pending').length,
    [state.bookings]
  );
  const activeJobs = useMemo(
    () => state.bookings.filter((booking) => booking.status === 'accepted').length,
    [state.bookings]
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eyebrow, { color: colors.accent }]}>Control Center</Text>
              <Text style={[styles.title, { color: colors.text }]}>Admin Overview</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Platform health and operations dashboard.</Text>
            </View>
            <TouchableOpacity style={[styles.heroBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setShowNewMessage(true)}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} />
              <Text style={[styles.heroBtnText, { color: colors.text }]}>New Message</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Pending</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{pendingBookings}</Text>
            <Text style={[styles.statMeta, { color: colors.destructive }]}>Attention</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Active Jobs</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{activeJobs}</Text>
            <Text style={[styles.statMeta, { color: colors.accent }]}>Live now</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border, marginRight: 0 }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Revenue</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>R12k</Text>
            <Text style={[styles.statMeta, { color: '#10b981' }]}>+12.5%</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Trust & Safety</Text>
          <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
            Review reported content, user disputes, and community standards.
          </Text>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => navigation.navigate('AdminModeration')}>
            <Ionicons name="shield-half-outline" size={18} color={colors.destructive} />
            <Text style={[styles.actionText, { color: colors.text }]}>Moderation queue</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Operations</Text>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => navigation.navigate('Root', { screen: 'Bookings' })}>
            <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            <Text style={[styles.actionText, { color: colors.text }]}>Browse all bookings</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => navigation.navigate('Root', { screen: 'Chat' })}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
            <Text style={[styles.actionText, { color: colors.text }]}>Open conversations</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => navigation.navigate('Compliance')}>
            <Ionicons name="file-tray-full-outline" size={18} color={colors.text} />
            <Text style={[styles.actionText, { color: colors.text }]}>Compliance & Logs</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <NewMessageModal
        visible={showNewMessage}
        onClose={() => setShowNewMessage(false)}
        profiles={state.profiles ?? []}
        currentUserId={state.currentUser?.id}
        onSelectUser={async (user) => {
          const convo = await startConversationWithUser(user.id, user.full_name ?? 'User');
          setShowNewMessage(false);
          navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 20, paddingBottom: 120 },
  hero: { marginBottom: 24 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eyebrow: { fontWeight: '900', marginBottom: 4, letterSpacing: 1, fontSize: 12, textTransform: 'uppercase' },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  subtitle: { fontSize: 16, marginTop: 4 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  heroBtnText: { fontWeight: '700', fontSize: 13 },
  statsRow: { flexDirection: 'row', marginBottom: 20, gap: 10 },
  statCard: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
  },
  statLabel: { fontWeight: '700', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 22, fontWeight: '900', marginTop: 4 },
  statMeta: { fontWeight: '700', fontSize: 11, marginTop: 4 },
  card: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    marginBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  cardTitle: { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  cardBody: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
  },
  actionText: { fontWeight: '700', fontSize: 15 },
});

export default AdminDashboardScreen;
