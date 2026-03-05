import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

const TermsScreen: React.FC = () => (
  <ScrollView contentContainerStyle={styles.container}>
    <Text style={styles.title}>Terms of Service</Text>
    <Text style={styles.paragraph}>
      Papzi connects users with verified photographers for on-demand bookings. Users agree to provide accurate
      location information and to follow local laws during sessions. Photographers agree to deliver content on time
      and comply with community guidelines.
    </Text>
    <Text style={styles.paragraph}>
      Payments are processed through PayFast. Papzi retains a commission on completed bookings. Disputes can be
      opened through the Support flow and are reviewed by our admin team.
    </Text>
    <Text style={styles.paragraph}>
      Replace this placeholder with your official terms text and include your legal entity details.
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

export default TermsScreen;
