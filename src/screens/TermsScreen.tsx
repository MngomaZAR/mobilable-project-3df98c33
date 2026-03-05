import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const TermsScreen: React.FC = () => (
  <ScrollView contentContainerStyle={styles.container}>
    <Text style={styles.title}>Terms of Service</Text>
    <Text style={styles.effectiveDate}>Effective date: March 5, 2026</Text>

    <Section title="1. Acceptance of Terms">
      <Text style={styles.body}>
        By downloading, installing, or using the Papzi mobile application ("App"), you agree to be
        bound by these Terms of Service ("Terms"). If you do not agree, do not use the App.
      </Text>
    </Section>

    <Section title="2. Description of Service">
      <Text style={styles.body}>
        Papzi is a photography marketplace that connects clients with photographers. The App enables
        browsing photographer profiles, requesting bookings, real-time messaging, social feed
        interaction, and processing payments through third-party payment providers.
      </Text>
    </Section>

    <Section title="3. User Accounts">
      <Text style={styles.body}>
        You must create an account to access core features. You are responsible for maintaining the
        confidentiality of your credentials and for all activities under your account. You must
        provide accurate information and promptly update it if it changes. We reserve the right to
        suspend or terminate accounts that violate these Terms.
      </Text>
    </Section>

    <Section title="4. User Conduct">
      <Text style={styles.body}>
        You agree not to: (a) upload content that is illegal, harmful, or infringes on intellectual
        property rights; (b) impersonate another person or entity; (c) attempt to gain unauthorized
        access to the App or its systems; (d) use the App for spam, phishing, or any fraudulent
        activity; (e) interfere with other users' enjoyment of the App.
      </Text>
    </Section>

    <Section title="5. Bookings and Payments">
      <Text style={styles.body}>
        Papzi facilitates connections between clients and photographers. All bookings are subject to
        availability and photographer acceptance. Payments are processed by third-party providers
        (e.g. PayFast). Papzi is not liable for disputes between clients and photographers regarding
        service quality, pricing, or delivery. Refund policies are determined by individual
        photographers unless otherwise stated.
      </Text>
    </Section>

    <Section title="6. Intellectual Property">
      <Text style={styles.body}>
        Content you upload remains yours. By posting content on Papzi, you grant us a non-exclusive,
        worldwide, royalty-free license to display, distribute, and promote that content within the
        App. Photographers retain all rights to their portfolio images. You may not copy, reproduce,
        or redistribute content from the App without the copyright holder's permission.
      </Text>
    </Section>

    <Section title="7. Limitation of Liability">
      <Text style={styles.body}>
        The App is provided "as is" and "as available" without warranties of any kind, express or
        implied. Papzi shall not be liable for any indirect, incidental, special, consequential, or
        punitive damages arising from your use of the App, including but not limited to loss of data
        or business opportunities.
      </Text>
    </Section>

    <Section title="8. Termination">
      <Text style={styles.body}>
        We may terminate or suspend your access at any time, without prior notice, for conduct that
        we determine violates these Terms or is harmful to other users or the App. Upon termination,
        your right to use the App ceases immediately.
      </Text>
    </Section>

    <Section title="9. Changes to Terms">
      <Text style={styles.body}>
        We may update these Terms from time to time. We will notify you of material changes through
        the App or via email. Continued use of the App after changes constitutes acceptance of the
        revised Terms.
      </Text>
    </Section>

    <Section title="10. Contact">
      <Text style={styles.body}>
        For questions about these Terms, contact us at support@papzi.app.
      </Text>
    </Section>
  </ScrollView>
);

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f7f7fb',
    paddingBottom: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  effectiveDate: {
    color: '#475569',
    marginTop: 4,
    marginBottom: 16,
    fontSize: 13,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  body: {
    color: '#334155',
    lineHeight: 22,
    fontSize: 14,
  },
});

export default TermsScreen;
