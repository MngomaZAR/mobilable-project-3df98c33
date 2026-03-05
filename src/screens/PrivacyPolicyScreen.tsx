import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

const PrivacyPolicyScreen: React.FC = () => (
  <ScrollView contentContainerStyle={styles.container}>
    <Text style={styles.title}>Privacy Policy</Text>
    <Text style={styles.paragraph}>
      Papzi collects the minimum information required to provide bookings, payments, and messaging. Your account
      details are stored in Supabase. Location data is used to power discovery and booking workflows, and is only
      stored when you submit a booking request or enable live location features.
    </Text>
    <Text style={styles.paragraph}>
      You can request data deletion at any time from Settings or Privacy & Permissions. We log deletion requests for
      compliance and respond within applicable regulatory timelines.
    </Text>
    <Text style={styles.paragraph}>
      For full legal copy, replace this placeholder with your official policy URL and text.
    </Text>
  </ScrollView>
);

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f7f7fb',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  paragraph: {
    color: '#475569',
    marginBottom: 12,
    lineHeight: 20,
  },
});

export default PrivacyPolicyScreen;
