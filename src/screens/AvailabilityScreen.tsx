import React, { useState, useEffect } from 'react';
import { 
  ScrollView, 
  StyleSheet, 
  Text, 
  TouchableOpacity, 
  View, 
  ActivityIndicator, 
  Switch,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { fetchAvailability, updateAvailability, Availability } from '../services/calendarService';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const AvailabilityScreen: React.FC = () => {
  const { colors, isDark } = useTheme();
  const { currentUser } = useAppData();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const userId = currentUser?.id ?? null;

  useEffect(() => {
    if (userId) {
      loadAvailability();
    } else {
      setLoading(false);
    }
  }, [userId]);

  const loadAvailability = async () => {
    if (!userId) return;
    try {
      const data = await fetchAvailability(userId);
      // Initialize with all days if empty
      if (data.length === 0) {
        setAvailability(DAYS.map((_, i) => ({
          id: '',
          user_id: userId,
          day_of_week: i,
          start_time: '09:00',
          end_time: '18:00',
          is_available: i > 0 && i < 6, // Default Mon-Fri
        })));
      } else {
        setAvailability(data.sort((a, b) => a.day_of_week - b.day_of_week));
      }
    } catch (err: any) {
      Alert.alert('Error', 'Failed to load availability settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (dayIndex: number) => {
    setAvailability(prev => prev.map(item => 
      item.day_of_week === dayIndex ? { ...item, is_available: !item.is_available } : item
    ));
  };

  const handleSave = async () => {
    if (!userId) {
      Alert.alert('Session Error', 'Please sign in again to update your availability.');
      return;
    }
    setSaving(true);
    try {
      await updateAvailability(userId, availability);
      Alert.alert('Success', 'Availability updated successfully.');
    } catch (err: any) {
      Alert.alert('Error', 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Working Hours</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Set your standard weekly availability for bookings.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {availability.map((item, index) => (
            <View key={item.day_of_week} style={[styles.dayRow, { borderBottomWidth: index === 6 ? 0 : StyleSheet.hairlineWidth, borderColor: colors.border }]}>
              <View style={styles.dayInfo}>
                <Text style={[styles.dayName, { color: item.is_available ? colors.text : colors.textMuted }]}>
                  {DAYS[item.day_of_week]}
                </Text>
                {item.is_available ? (
                  <Text style={[styles.timeRange, { color: colors.accent }]}>
                    {item.start_time} - {item.end_time}
                  </Text>
                ) : (
                  <Text style={[styles.timeRange, { color: colors.textMuted }]}>Unavailable</Text>
                )}
              </View>
              <Switch 
                value={item.is_available} 
                onValueChange={() => handleToggle(item.day_of_week)} 
                trackColor={{ false: colors.border, true: colors.accent }}
              />
            </View>
          ))}
        </View>

        <TouchableOpacity 
          style={[styles.saveBtn, { backgroundColor: colors.text }]} 
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={[styles.saveBtnText, { color: colors.bg }]}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Text>
        </TouchableOpacity>

        <View style={[styles.infoBox, { backgroundColor: colors.accent + '10' }]}>
            <Ionicons name="calendar-outline" size={20} color={colors.accent} />
            <Text style={[styles.infoText, { color: colors.accent }]}>
                Tip: Use the "Block Dates" feature in your dashboard to handle one-off holidays and breaks.
            </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { padding: 20, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, marginTop: 4, lineHeight: 22 },
  container: { padding: 20, paddingBottom: 40 },
  card: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, marginBottom: 20 },
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18 },
  dayInfo: { flex: 1 },
  dayName: { fontSize: 16, fontWeight: '700' },
  timeRange: { fontSize: 14, marginTop: 2, fontWeight: '600' },
  saveBtn: { 
    height: 56, 
    borderRadius: 16, 
    justifyContent: 'center', 
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4
  },
  saveBtnText: { fontSize: 16, fontWeight: '800' },
  infoBox: { flexDirection: 'row', alignItems: 'center', marginTop: 24, padding: 16, borderRadius: 16, gap: 12 },
  infoText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export default AvailabilityScreen;
