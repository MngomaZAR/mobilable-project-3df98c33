import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation } from '@react-navigation/native';
import { useAppData } from '../store/AppDataContext';
import { environment } from '../config/environment';
import { RootStackParamList } from '../navigation/types';
import { AppLogo } from '../components/AppLogo';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const SettingsScreen: React.FC = () => {
  const { resetState, saving } = useAppData();
  const navigation = useNavigation<Navigation>();
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(true);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <AppLogo size={60} />
        <View style={styles.headerText}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.meta}>Papzi mobile photography marketplace</Text>
        </View>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Notifications</Text>
        <Switch value={notificationsEnabled} onValueChange={setNotificationsEnabled} />
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Environment</Text>
        <Text style={styles.meta}>Env: {environment.env}</Text>
        <Text style={styles.meta}>Region: {environment.region}</Text>
        <Text style={styles.meta}>Support: {environment.supportEmail}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Terms of Service</Text>
        <Text style={styles.paragraph}>
          Placeholder terms: booking requests remain local on your device. Add your own terms when you connect your
          backend and legal copy.
        </Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy Policy</Text>
        <Text style={styles.paragraph}>
          Placeholder privacy policy: this demo stores data in AsyncStorage on your device only. No external services
          are contacted.
        </Text>
      </View>
      <TouchableOpacity style={styles.linkCard} onPress={() => navigation.navigate('Auth')}>
        <Text style={styles.linkTitle}>Account & Auth</Text>
        <Text style={styles.linkMeta}>Email/password login and signup with Supabase.</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkCard} onPress={() => navigation.navigate('Compliance')}>
        <Text style={styles.linkTitle}>Privacy & Permissions</Text>
        <Text style={styles.linkMeta}>Location toggle, privacy controls, data deletion request.</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.reset} onPress={resetState} disabled={saving}>
        <Text style={styles.resetText}>{saving ? 'Resetting...' : 'Reset local data'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f7f7fb',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerText: {
    marginLeft: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  label: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '600',
  },
  section: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  paragraph: {
    color: '#475569',
    lineHeight: 20,
  },
  meta: {
    color: '#475569',
    marginTop: 2,
  },
  reset: {
    backgroundColor: '#dc2626',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  resetText: {
    color: '#fff',
    fontWeight: '700',
  },
  linkCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    marginTop: 12,
  },
  linkTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  linkMeta: {
    color: '#475569',
    marginTop: 4,
  },
});

export default SettingsScreen;
