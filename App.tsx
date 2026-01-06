import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { LoadingOverlay } from './src/components/LoadingOverlay';
import { MainNavigator } from './src/navigation/MainNavigator';
import { AppDataProvider, useAppData } from './src/store/AppDataContext';
import { logo } from './src/assets/images';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const AppContent = () => {
  const { loading } = useAppData();

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

  if (loading) {
    return <LoadingOverlay message="Loading your workspace..." />;
  }

  return (
    <>
      <MainNavigator logoSource={logo} />
      <StatusBar style="dark" />
    </>
  );
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <ErrorBoundary>
            <AppDataProvider>
              <AppContent />
            </AppDataProvider>
          </ErrorBoundary>
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
