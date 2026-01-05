import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppLogo } from '../components/AppLogo';
import { useAppData } from '../store/AppDataContext';

const PendingVerificationScreen: React.FC = () => {
  const { currentUser, revalidateSession, signOut } = useAppData();
  const [checking, setChecking] = useState(false);

  const refreshStatus = async () => {
    setChecking(true);
    try {
      await revalidateSession();
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <AppLogo size={82} />
          <Text style={styles.title}>Verification pending</Text>
          <Text style={styles.subtitle}>
            We&apos;re reviewing your photographer profile. This can take a few minutes while we double-check
            your details.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="person-circle" size={28} color="#0f172a" />
            <View style={styles.rowText}>
              <Text style={styles.label}>Signed in as</Text>
              <Text style={styles.value}>{currentUser?.email ?? 'Unknown user'}</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Ionicons name="shield-checkmark" size={28} color="#0f172a" />
            <View style={styles.rowText}>
              <Text style={styles.label}>Status</Text>
              <Text style={styles.value}>Awaiting manual review</Text>
              <Text style={styles.meta}>Keep this screen open or refresh below to check again.</Text>
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.primary} onPress={refreshStatus} disabled={checking}>
            <Text style={styles.primaryText}>{checking ? 'Checking status...' : 'Refresh status'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={signOut}>
            <Text style={styles.secondaryText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.helper}>
          <Ionicons name="information-circle" size={22} color="#475569" />
          <Text style={styles.helperText}>
            We&apos;ll email you once you&apos;re approved. You can keep exploring the app while you wait.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f7f7fb',
  },
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f7f7fb',
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 8,
  },
  subtitle: {
    textAlign: 'center',
    color: '#475569',
    marginTop: 6,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  rowText: {
    flex: 1,
    marginLeft: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  value: {
    color: '#0f172a',
    marginTop: 2,
  },
  meta: {
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
  },
  actions: {
    marginTop: 4,
  },
  primary: {
    backgroundColor: '#0f172a',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondary: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    backgroundColor: '#e2e8f0',
    marginTop: 10,
  },
  secondaryText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  helper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  helperText: {
    flex: 1,
    color: '#475569',
    marginLeft: 8,
  },
});

export default PendingVerificationScreen;
