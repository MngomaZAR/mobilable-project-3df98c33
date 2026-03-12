import 'react-native-url-polyfill/auto';
import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { LoadingOverlay } from './src/components/LoadingOverlay';
import { MainNavigator } from './src/navigation/MainNavigator';
import { AppDataProvider, useAppData } from './src/store/AppDataContext';
import { ThemeProvider, useTheme } from './src/store/ThemeContext';
import { AuthProvider } from './src/store/AuthContext';
import { MessagingProvider } from './src/store/MessagingContext';
import { BookingProvider } from './src/store/BookingContext';
import { SocialProvider } from './src/store/SocialContext';
import { logo } from './src/assets/images';
import { Ionicons } from '@expo/vector-icons';
import { Animated, Text, StyleSheet } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const AppContent = () => {
  const { loading, error, currentUser } = useAppData();
  const insets = useSafeAreaInsets();
  
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);
  const slideAnim = React.useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    if (error) {
      setToastMessage(error);
      Animated.spring(slideAnim, {
        toValue: insets.top + 10,
        useNativeDriver: true,
      }).start();
      const timer = setTimeout(() => {
        Animated.timing(slideAnim, {
          toValue: -100,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setToastMessage(null));
      }, 4000);
      return () => clearTimeout(timer);
    } else {
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setToastMessage(null));
    }
  }, [error, insets.top]);

  const { isDark } = useTheme();

  useEffect(() => {
    const requestPermissions = async () => {
      try {
        await Notifications.requestPermissionsAsync();
      } catch (err) {
        console.warn('Notification permission failed', err);
      }
    };
    requestPermissions();
  }, []);

  if (loading && !error && !currentUser) {
    return <LoadingOverlay message="Loading your workspace..." />;
  }

  return (
    <>
      <MainNavigator logoSource={logo} />
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {toastMessage && (
        <Animated.View style={[styles.toastContainer, { transform: [{ translateY: slideAnim }] }]}>
          <Ionicons name="alert-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    backgroundColor: '#dc2626',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    zIndex: 9999,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <BookingProvider>
              <SocialProvider>
                <ErrorBoundary>
                  <AppDataProvider>
                    {/* MessagingProvider is INSIDE AppDataProvider so it has auth context */}
                    <MessagingProvider>
                      <AppContent />
                    </MessagingProvider>
                  </AppDataProvider>
                </ErrorBoundary>
              </SocialProvider>
            </BookingProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
