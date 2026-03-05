import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation } from '@react-navigation/native';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { AppLogo } from '../components/AppLogo';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const SettingsScreen: React.FC = () => {
  const { resetState, saving, currentUser, signOut } = useAppData();
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
      <TouchableOpacity style={styles.linkCard} onPress={() => navigation.navigate('Support')}>
        <Text style={styles.linkTitle}>Support</Text>
        <Text style={styles.linkMeta}>Open a ticket or request help from the Papzi team.</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkCard} onPress={() => navigation.navigate('PrivacyPolicy')}>
        <Text style={styles.linkTitle}>Privacy policy</Text>
        <Text style={styles.linkMeta}>Learn how Papzi handles your data.</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkCard} onPress={() => navigation.navigate('Terms')}>
        <Text style={styles.linkTitle}>Terms of service</Text>
        <Text style={styles.linkMeta}>Review the Papzi terms of service.</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkCard} onPress={() => navigation.navigate('Auth')}>
        <Text style={styles.linkTitle}>Account & Auth</Text>
        <Text style={styles.linkMeta}>Manage sign-in options and account access.</Text>
      </TouchableOpacity>
      {currentUser?.role === 'photographer' ? (
        <TouchableOpacity style={styles.linkCard} onPress={() => navigation.navigate('PhotographerDashboard')}>
          <Text style={styles.linkTitle}>Photographer dashboard</Text>
          <Text style={styles.linkMeta}>Manage requests, track jobs, and chat with clients.</Text>
        </TouchableOpacity>
      ) : null}
      {currentUser?.role === 'admin' ? (
        <TouchableOpacity style={styles.linkCard} onPress={() => navigation.navigate('AdminDashboard')}>
          <Text style={styles.linkTitle}>Admin dashboard</Text>
          <Text style={styles.linkMeta}>Monitor platform activity and data health.</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={styles.linkCard} onPress={() => navigation.navigate('Compliance')}>
        <Text style={styles.linkTitle}>Privacy & Permissions</Text>
        <Text style={styles.linkMeta}>Location toggle, privacy controls, data deletion request.</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkCard} onPress={() => navigation.navigate('AccountDelete')}>
        <Text style={styles.linkTitle}>Account deletion</Text>
        <Text style={styles.linkMeta}>Submit a deletion request for your account.</Text>
      </TouchableOpacity>
      {currentUser ? (
        <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutButtonText}>Sign out</Text>
        </TouchableOpacity>
      ) : null}
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
  meta: {
    color: '#475569',
    marginTop: 2,
  },
  signOutButton: {
    backgroundColor: '#0f172a',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  signOutButtonText: {
    color: '#fff',
    fontWeight: '700',
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
