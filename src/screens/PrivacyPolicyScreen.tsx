import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const PrivacyPolicyScreen: React.FC = () => (
  <ScrollView contentContainerStyle={styles.container}>
    <Text style={styles.title}>Privacy Policy</Text>
    <Text style={styles.effectiveDate}>Effective date: March 5, 2026</Text>

    <Section title="1. Information We Collect">
      <Text style={styles.body}>
        We collect the following types of information:{'\n\n'}
        <Text style={styles.bold}>Account information:</Text> Email address and password when you
        create an account.{'\n\n'}
        <Text style={styles.bold}>Profile data:</Text> Name, avatar, and role (client or
        photographer) you provide.{'\n\n'}
        <Text style={styles.bold}>Location data:</Text> GPS coordinates when you enable location
        services to find nearby photographers or use live booking tracking. Location is only
        collected when the feature is actively enabled in your Privacy settings.{'\n\n'}
        <Text style={styles.bold}>Photos and media:</Text> Images you upload to the social feed or
        portfolio. These are stored on our servers.{'\n\n'}
        <Text style={styles.bold}>Usage data:</Text> App interactions, booking history, messages
        sent through the chat system, and post engagement (likes, comments).{'\n\n'}
        <Text style={styles.bold}>Device information:</Text> Device type, operating system version,
        and push notification tokens.
      </Text>
    </Section>

    <Section title="2. How We Use Your Information">
      <Text style={styles.body}>
        We use collected information to: (a) provide and maintain the App; (b) process bookings and
        facilitate payments through third-party providers; (c) enable messaging between clients and
        photographers; (d) display relevant photographer listings based on your location; (e) send
        push notifications about booking updates and messages; (f) improve and personalize your
        experience; (g) detect and prevent fraud or abuse.
      </Text>
    </Section>

    <Section title="3. Data Sharing">
      <Text style={styles.body}>
        We do not sell your personal information. We share data only with:{'\n\n'}
        <Text style={styles.bold}>Photographers:</Text> Your booking requests and messages are
        shared with the photographers you interact with.{'\n\n'}
        <Text style={styles.bold}>Payment providers:</Text> Payment information is processed by
        PayFast or other third-party payment processors. We do not store your credit card details.
        {'\n\n'}
        <Text style={styles.bold}>Service providers:</Text> We use Supabase for authentication and
        data storage, and Expo for push notifications. These providers process data on our behalf
        under strict confidentiality agreements.{'\n\n'}
        <Text style={styles.bold}>Legal requirements:</Text> We may disclose information when
        required by law or to protect our rights and safety.
      </Text>
    </Section>

    <Section title="4. Data Storage and Security">
      <Text style={styles.body}>
        Your data is stored securely using Supabase with row-level security policies. Local data on
        your device is stored in AsyncStorage. We use HTTPS encryption for all data transmission. We
        implement industry-standard security measures, but no method of electronic storage is 100%
        secure.
      </Text>
    </Section>

    <Section title="5. Your Rights and Controls">
      <Text style={styles.body}>
        You have the right to:{'\n\n'}
        - Access and update your personal information through your profile settings.{'\n'}
        - Toggle location sharing, marketing communications, and personalized ads in Privacy and
        Permissions settings.{'\n'}
        - Request deletion of your account and all associated data through the Privacy and
        Permissions screen.{'\n'}
        - Export your data by contacting us at the address below.{'\n\n'}
        Deletion requests are processed within 30 days. Some data may be retained as required by law
        or for legitimate business purposes.
      </Text>
    </Section>

    <Section title="6. Children's Privacy">
      <Text style={styles.body}>
        The App is not intended for users under the age of 13. We do not knowingly collect personal
        information from children. If we discover that a child under 13 has provided us with
        personal information, we will delete it immediately.
      </Text>
    </Section>

    <Section title="7. Third-Party Links">
      <Text style={styles.body}>
        The App may contain links to third-party websites or services. We are not responsible for
        the privacy practices of these external sites.
      </Text>
    </Section>

    <Section title="8. Changes to This Policy">
      <Text style={styles.body}>
        We may update this Privacy Policy from time to time. We will notify you of significant
        changes through the App or via email. Your continued use of the App after changes constitutes
        acceptance of the updated policy.
      </Text>
    </Section>

    <Section title="9. Contact Us">
      <Text style={styles.body}>
        For privacy questions, data requests, or concerns, contact us at:{'\n\n'}
        Email: privacy@papzi.app{'\n'}
        Support: support@papzi.app
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
  bold: {
    fontWeight: '700',
    color: '#0f172a',
  },
});

export default PrivacyPolicyScreen;
