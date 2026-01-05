import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppData } from '../store/AppDataContext';

const ComplianceScreen: React.FC = () => {
  const { state, updatePrivacy, requestDataDeletion } = useAppData();
  const [notes, setNotes] = useState('');

  const toggleLocation = (value: boolean) => {
    updatePrivacy({ locationEnabled: value });
  };

  const toggleMarketing = (value: boolean) => updatePrivacy({ marketingOptIn: value });
  const togglePersonalizedAds = (value: boolean) => updatePrivacy({ personalizedAds: value });

  const deleteRequest = async () => {
    await requestDataDeletion();
    Alert.alert('Request logged', 'We recorded your deletion request with timestamp for audit.');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Privacy & Permissions</Text>
      <Text style={styles.subtitle}>Fine-grained controls to stay compliant with app store policies.</Text>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>Location sharing</Text>
          <Text style={styles.meta}>Toggle GPS use for discovery & live tracking.</Text>
        </View>
        <Switch value={state.privacy.locationEnabled} onValueChange={toggleLocation} />
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>Marketing email opt-in</Text>
          <Text style={styles.meta}>Stay informed about new photographers and offers.</Text>
        </View>
        <Switch value={state.privacy.marketingOptIn} onValueChange={toggleMarketing} />
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>Personalized ads</Text>
          <Text style={styles.meta}>Control analytics and ad personalization toggles.</Text>
        </View>
        <Switch value={state.privacy.personalizedAds} onValueChange={togglePersonalizedAds} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data deletion</Text>
        <Text style={styles.meta}>
          Request deletion of your data. We log the request locally and send it to backend when connected.
        </Text>
        <TextInput
          placeholder="Add optional details for your deletion request"
          value={notes}
          onChangeText={setNotes}
          style={styles.input}
          multiline
        />
        <TouchableOpacity style={styles.danger} onPress={deleteRequest}>
          <Text style={styles.dangerText}>Submit deletion request</Text>
        </TouchableOpacity>
        {state.privacy.dataDeletionRequestedAt ? (
          <Text style={styles.timestamp}>Requested at: {state.privacy.dataDeletionRequestedAt}</Text>
        ) : null}
      </View>
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
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
    color: '#475569',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  meta: {
    color: '#475569',
    marginTop: 4,
  },
  section: {
    marginTop: 16,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    backgroundColor: '#f8fafc',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  danger: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    alignItems: 'center',
  },
  dangerText: {
    color: '#fff',
    fontWeight: '700',
  },
  timestamp: {
    marginTop: 8,
    color: '#0f172a',
    fontWeight: '600',
  },
});

export default ComplianceScreen;

