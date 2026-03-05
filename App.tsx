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
import { supabase } from './src/config/supabaseClient';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const AppContent = () => {
  const { loading, currentUser } = useAppData();

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

  useEffect(() => {
    if (typeof ErrorUtils === 'undefined') return;
    const defaultHandler = (ErrorUtils as any).getGlobalHandler?.();
    (ErrorUtils as any).setGlobalHandler?.((error: any, isFatal?: boolean) => {
      try {
        supabase.from('error_reports').insert({
          created_by: currentUser?.id ?? null,
          message: String(error?.message ?? 'Unknown error'),
          stack: String(error?.stack ?? ''),
          context: { isFatal: Boolean(isFatal) },
        });
      } catch (err) {
        console.warn('Failed to report error', err);
      } finally {
        if (defaultHandler) {
          defaultHandler(error, isFatal);
        }
      }
    });
  }, [currentUser?.id]);

  if (loading) {
    return <LoadingOverlay message="Loading your workspace..." />;
  }

  return (
    <>
      <MainNavigator logoSource={logo} isAuthenticated={Boolean(currentUser)} role={currentUser?.role ?? null} />
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
