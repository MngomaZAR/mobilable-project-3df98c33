import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';

type Props = {
  paymentUrl: string;
  onSuccess: () => void;
  onError: (message: string) => void;
};

export const PaymentWebView: React.FC<Props> = ({ paymentUrl, onSuccess, onError }) => {
  const handleNavChange = (event: WebViewNavigation) => {
    if (event.url.includes('status=success') || event.url.includes('pf_status=COMPLETE')) {
      onSuccess();
    }
    if (event.url.includes('status=cancel')) {
      onError('Payment cancelled');
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: paymentUrl }}
        onNavigationStateChange={handleNavChange}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator />
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 420,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

