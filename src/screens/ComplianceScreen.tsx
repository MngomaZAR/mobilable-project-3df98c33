import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ComplianceScreen: React.FC = () => {
  const { state, updatePrivacy, requestDataDeletion } = useAppData();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState('');

  const toggleLocation = (value: boolean) => updatePrivacy({ locationEnabled: value });
  const toggleMarketing = (value: boolean) => updatePrivacy({ marketingOptIn: value });
  const togglePersonalizedAds = (value: boolean) => updatePrivacy({ personalizedAds: value });

  const deleteRequest = async () => {
    Alert.alert(
      'Confirm Deletion',
      'This will request permanent deletion of your account and data. This action is tracked for audit compliance.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Submit Request', 
          style: 'destructive', 
          onPress: async () => {
            await requestDataDeletion();
            Alert.alert('Request Received', 'Your deletion request has been logged and we will process it within the statutory timeframe.');
          }
        }
      ]
    );
  };

  return (
    <ScrollView 
      style={[styles.scrollView, { backgroundColor: colors.bg }]}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
    >
      <View style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: colors.accent + '20' }]}>
          <Ionicons name="shield-checkmark" size={32} color={colors.accent} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>Privacy & Trust</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Manage your data footprint and permissions to stay compliant with global privacy standards.
        </Text>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Permissions</Text>
        
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.label, { color: colors.text }]}>Location Services</Text>
            <Text style={[styles.meta, { color: colors.textMuted }]}>Used for shoot discovery and live booking tracking.</Text>
          </View>
          <Switch 
            value={state.privacy.locationEnabled} 
            onValueChange={toggleLocation}
            trackColor={{ false: colors.border, true: colors.accent }}
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.label, { color: colors.text }]}>Marketing Communications</Text>
            <Text style={[styles.meta, { color: colors.textMuted }]}>Receive updates on new creators and platform features.</Text>
          </View>
          <Switch 
            value={state.privacy.marketingOptIn} 
            onValueChange={toggleMarketing}
            trackColor={{ false: colors.border, true: colors.accent }}
          />
        </View>

        <View style={[styles.row, { borderBottomWidth: 0 }]}>
          <View style={styles.rowText}>
            <Text style={[styles.label, { color: colors.text }]}>Personalized Experience</Text>
            <Text style={[styles.meta, { color: colors.textMuted }]}>Help us improve Papzi by allowing anonymous analytics.</Text>
          </View>
          <Switch 
            value={state.privacy.personalizedAds} 
            onValueChange={togglePersonalizedAds}
            trackColor={{ false: colors.border, true: colors.accent }}
          />
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Right to Erasure (POPIA/GDPR)</Text>
        <Text style={[styles.meta, { color: colors.textSecondary, marginBottom: 12 }]}>
          You have the right to request deletion of your data. We retain a record of this request for compliance auditing.
        </Text>
        
        <TextInput
          placeholder="Details for your request (optional)"
          placeholderTextColor={colors.textMuted}
          value={notes}
          onChangeText={setNotes}
          style={[styles.input, { 
            backgroundColor: colors.bg, 
            borderColor: colors.border,
            color: colors.text 
          }]}
          multiline
        />

        <TouchableOpacity 
          style={[styles.dangerBtn, { backgroundColor: colors.destructive + '15' }]} 
          onPress={deleteRequest}
        >
          <Text style={[styles.dangerBtnText, { color: colors.destructive }]}>Submit Deletion Request</Text>
        </TouchableOpacity>

        {state.privacy.dataDeletionRequestedAt ? (
          <View style={[styles.statusBadge, { backgroundColor: colors.accent + '10' }]}>
            <Ionicons name="time-outline" size={14} color={colors.accent} />
            <Text style={[styles.statusText, { color: colors.accent }]}>
              Request logged: {new Date(state.privacy.dataDeletionRequestedAt).toLocaleDateString()}
            </Text>
          </View>
        ) : null}
      </View>
      
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textMuted }]}>
          Papzi remains committed to your data security. 
          View our full Privacy Policy at papzi.com/legal
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  section: {
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 16,
    letterSpacing: -0.2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  rowText: {
    flex: 1,
    paddingRight: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
  },
  meta: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  input: {
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
    minHeight: 100,
    textAlignVertical: 'top',
    fontSize: 15,
    borderWidth: 1,
  },
  dangerBtn: {
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  dangerBtnText: {
    fontWeight: '800',
    fontSize: 15,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  footer: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 40,
  }
});

export default ComplianceScreen;
