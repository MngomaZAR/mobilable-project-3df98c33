import React, { useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';

type Props = {
  paymentUrl: string;
  onSuccess?: () => void;
  onError: (message: string) => void;
  successUrlPrefix?: string;
  cancelUrlPrefix?: string;
};

export const PaymentWebView: React.FC<Props> = ({
  paymentUrl,
  onSuccess,
  onError,
  successUrlPrefix,
  cancelUrlPrefix,
}) => {
  const hasCompletedRef = useRef(false);

  const getRedirectType = (urlValue: string) => {
    const url = urlValue.toLowerCase();
    const matchesSuccessPrefix =
      !!successUrlPrefix && url.startsWith(successUrlPrefix.toLowerCase());
    const matchesCancelPrefix =
      !!cancelUrlPrefix && url.startsWith(cancelUrlPrefix.toLowerCase());

    if (matchesSuccessPrefix) return 'success';
    if (matchesCancelPrefix) return 'cancel';
    return null;
  };

  const completeRedirect = (kind: 'success' | 'cancel') => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    if (kind === 'success') onSuccess?.();
    else onError('Payment cancelled');
  };

  const handleNavChange = (event: WebViewNavigation) => {
    const url = event.url.toLowerCase();
    const redirectType = getRedirectType(url);
    if (redirectType) completeRedirect(redirectType);
  };

  const handleLoadError = (event: any) => {
    onError(event.nativeEvent.description || 'Unable to load secure checkout.');
  };

  const handleHttpError = (event: any) => {
    onError(`Checkout returned HTTP ${event.nativeEvent.statusCode}.`);
  };

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: paymentUrl }}
        onShouldStartLoadWithRequest={(request) => {
          const redirectType = getRedirectType(request.url);
          if (redirectType) {
            completeRedirect(redirectType);
            return false;
          }
          return true;
        }}
        onNavigationStateChange={handleNavChange}
        onError={handleLoadError}
        onHttpError={handleHttpError}
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
