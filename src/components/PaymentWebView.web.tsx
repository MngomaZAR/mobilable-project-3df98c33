import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  paymentUrl: string;
  onSuccess: () => void;
  onError: (message: string) => void;
};

export const PaymentWebView: React.FC<Props> = ({ paymentUrl, onSuccess, onError }) => {
  const openLink = async () => {
    try {
      await Linking.openURL(paymentUrl);
    } catch (err) {
      onError('Unable to open PayFast checkout on web.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>PayFast is opened in a new tab on web.</Text>
      <Text style={styles.subtitle}>Complete the payment then mark it as paid to continue.</Text>
      <TouchableOpacity style={styles.button} onPress={openLink}>
        <Text style={styles.buttonText}>Open PayFast checkout</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={onSuccess}>
        <Text style={styles.secondaryText}>Simulate success</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#f9fafb',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 10,
    color: '#475569',
  },
  button: {
    backgroundColor: '#0f172a',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondary: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
  },
  secondaryText: {
    color: '#0f172a',
    fontWeight: '700',
  },
});

