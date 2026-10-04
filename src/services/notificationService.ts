import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { backendDb } from './backendGateway';

let notificationsModule: typeof import('expo-notifications') | null = null;

const shouldUseNotifications = () => Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient && Constants.appOwnership !== 'expo';

const getNotifications = async () => {
  if (!shouldUseNotifications()) return null;
  if (!notificationsModule) {
    notificationsModule = require('expo-notifications') as typeof import('expo-notifications');
    notificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
  return notificationsModule;
};

export async function getLastPushPayload(): Promise<Record<string, unknown> | null> {
  try {
    const notifications = await getNotifications();
    if (!notifications) return null;
    const response = await notifications.getLastNotificationResponseAsync();
    return response?.actionIdentifier === notifications.DEFAULT_ACTION_IDENTIFIER ? response.notification.request.content.data : null;
  } catch { return null; }
}

export function subscribeToPushResponses(listener: (data: Record<string, unknown>) => void) {
  let cancelled = false;
  let subscription: { remove: () => void } | undefined;
  void getNotifications().then(notifications => {
    if (cancelled || !notifications) return;
    subscription = notifications.addNotificationResponseReceivedListener(response => {
      if (!cancelled && response.actionIdentifier === notifications.DEFAULT_ACTION_IDENTIFIER) listener(response.notification.request.content.data);
    });
  }).catch(() => {});
  return () => { cancelled = true; subscription?.remove(); };
}

export async function registerForPushNotificationsAsync() {
  if (!shouldUseNotifications()) {
    return null;
  }
  let token;
  const Notifications = await getNotifications();
  if (!Notifications) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.warn('Failed to get permission for push notification!');
      return;
    }
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    
    try {
      token = (
        await Notifications.getExpoPushTokenAsync({
          projectId,
        })
      ).data;
    } catch (e) {
      console.warn('Failed to generate push token', e);
    }
  } else {
    // Simulator
    console.warn('Must use physical device for Push Notifications');
  }

  return token;
}

export async function savePushTokenAsync(userId: string, token: string) {
  try {
    // Write to the dedicated push_tokens table so push-dispatcher edge fn can find it.
    // Also update profiles.push_token for legacy compatibility.
    const platform: 'ios' | 'android' | 'web' =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

    const { error: tokenError } = await backendDb.from('push_tokens').upsert(
      {
        user_id: userId,
        expo_push_token: token,
        platform,
        enabled: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,expo_push_token' }
    );
    if (tokenError) {
      console.warn('Failed to upsert push_tokens row:', tokenError.message);
    }

    // Keep profiles.push_token in sync for legacy queries
    await backendDb.from('profiles').update({ push_token: token }).eq('id', userId);
  } catch (error) {
    console.error('Failed to save push token', error);
  }
}
