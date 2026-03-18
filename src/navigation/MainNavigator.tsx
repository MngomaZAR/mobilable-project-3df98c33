import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DefaultTheme, useNavigation } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as Linking from 'expo-linking';
import { Image, ImageSourcePropType } from 'react-native';
import HomeScreen from '../screens/HomeScreen';
import BookingFormScreen from '../screens/BookingFormScreen';
import BookingDetailScreen from '../screens/BookingDetailScreen';
import BookingsScreen from '../screens/BookingsScreen';
import FeedScreen from '../screens/FeedScreen';
import PostDetailScreen from '../screens/PostDetailScreen';
import CreatePostScreen from '../screens/CreatePostScreen';
import ConversationsListScreen from '../screens/ConversationsListScreen';
import ChatScreen from '../screens/ChatScreen';
import UserProfileScreen from '../screens/UserProfileScreen';
import MapScreen from '../screens/MapScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AuthScreen from '../screens/AuthScreen';
import BookingTrackingScreen from '../screens/BookingTrackingScreen';
import PaymentScreen from '../screens/PaymentScreen';
import ComplianceScreen from '../screens/ComplianceScreen';
import PhotographerDashboardScreen from '../screens/PhotographerDashboardScreen';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import ModelPremiumDashboard from '../screens/ModelPremiumDashboard';
import PaidVideoCallScreen from '../screens/PaidVideoCallScreen';
import AccountConfigScreen from '../screens/AccountConfigScreen';
import { GlobalRequestManager } from '../components/GlobalRequestManager';
import NotificationsScreen from '../screens/NotificationsScreen';
import PaymentHistoryScreen from '../screens/PaymentHistoryScreen';
import SplashLoadingScreen from '../screens/SplashLoadingScreen';
import RoleSelectionScreen from '../screens/RoleSelectionScreen';
import AgeVerificationScreen from '../screens/AgeVerificationScreen';
import PendingVerificationScreen from '../screens/PendingVerificationScreen';
import AccessDeniedScreen from '../screens/AccessDeniedScreen';

import SupportScreen from '../screens/SupportScreen';
import EarningsDashboardScreen from '../screens/EarningsDashboardScreen';
import CreatorAnalyticsScreen from '../screens/CreatorAnalyticsScreen';
import CreatorSubscriptionsScreen from '../screens/CreatorSubscriptionsScreen';
import ReviewsScreen from '../screens/ReviewsScreen';
import MediaLibraryScreen from '../screens/MediaLibraryScreen';
import LegalScreen from '../screens/LegalScreen';
import AdminModerationScreen from '../screens/AdminModerationScreen';
import AvailabilityScreen from '../screens/AvailabilityScreen';
import ModelReleaseScreen from '../screens/ModelReleaseScreen';
import CreditsWalletScreen from '../screens/CreditsWalletScreen';
import PayoutMethodsScreen from '../screens/PayoutMethodsScreen';
import { RootStackParamList, TabParamList } from './types';
import { useAppData } from '../store/AppDataContext';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createStackNavigator<RootStackParamList>();

type MainNavigatorProps = {
  logoSource?: ImageSourcePropType;
};

const VerificationRejectedScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  return (
    <AccessDeniedScreen
      title="Verification Declined"
      message="Your verification submission was declined. Please contact support to review and resubmit."
      actionLabel="Contact Support"
      onAction={() => navigation.navigate('Support')}
      iconName="shield-outline"
    />
  );
};

const tabBarIcon = (routeName: keyof TabParamList, focused: boolean, color: string, size: number) => {
  const icons: Record<keyof TabParamList, { active: string; inactive: string }> = {
    Home: { active: 'home', inactive: 'home-outline' },
    Bookings: { active: 'calendar', inactive: 'calendar-outline' },
    Feed: { active: 'images', inactive: 'images-outline' },
    Chat: { active: 'chatbubble', inactive: 'chatbubble-outline' },
    Map: { active: 'map', inactive: 'map-outline' },
    Settings: { active: 'settings', inactive: 'settings-outline' },
  };
  const name = focused ? icons[routeName].active : icons[routeName].inactive;
  return <Ionicons name={name as any} size={size} color={color} />;
};

const TabsNavigator = () => {
  const { currentUser, state } = useAppData();
  const unreadNotifications = state.notifications.filter(n => n.status === 'queued').length;

  const role = currentUser?.role ?? 'client';
  const homeComponent =
    role === 'photographer'
      ? PhotographerDashboardScreen
      : role === 'model'
        ? ModelPremiumDashboard
        : role === 'admin'
          ? AdminDashboardScreen
          : HomeScreen;

  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => tabBarIcon(route.name, focused, color, size),
        tabBarActiveTintColor: '#111827',
        tabBarInactiveTintColor: '#9ca3af',
        headerShown: false,
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen
        name="Home"
        component={homeComponent}
        options={{ tabBarLabel: role === 'client' ? 'Home' : 'Dashboard' }}
      />
      <Tab.Screen name="Bookings" component={BookingsScreen} />
      <Tab.Screen name="Feed" component={FeedScreen} />
      <Tab.Screen name="Chat" component={ConversationsListScreen} />
      <Tab.Screen 
        name="Settings" 
        component={SettingsScreen} 
        options={{ 
          tabBarBadge: unreadNotifications > 0 ? unreadNotifications : undefined,
          tabBarBadgeStyle: { backgroundColor: '#ef4444', color: '#fff' }
        }} 
      />
    </Tab.Navigator>
  );
};

export const MainNavigator: React.FC<MainNavigatorProps> = ({ logoSource }) => {
  const { currentUser, loading } = useAppData();

  if (loading) {
    return <SplashLoadingScreen />;
  }

  const linking = {
    prefixes: [Linking.createURL('/'), 'papzi://'],
    config: {
      screens: {
        Root: {
          path: 'Root',
          screens: {
            Home: 'Home',
            Bookings: 'Bookings',
            Feed: 'Feed',
            Chat: 'Chat',
            Map: 'Map',
            Settings: 'Settings',
          },
        },
        Auth: 'auth',
        Profile: 'profile/:userId',
        BookingForm: 'booking/new/:photographerId',
        BookingDetail: 'booking/:bookingId',
        BookingTracking: 'booking/:bookingId/track',
        Payment: 'payment/:bookingId',
        PostDetail: 'post/:postId',
        CreatePost: 'post/new',
        UserProfile: 'user/:userId',
        Compliance: 'compliance',
        ChatThread: 'chat/:conversationId',
        AccountConfig: 'account/config',
        Notifications: 'notifications',
        PaymentHistory: 'payments/history',
        Support: 'support',
        EarningsDashboard: 'earnings',
        CreatorAnalytics: 'analytics',
        CreatorSubscriptions: 'subscriptions',
        CreditsWallet: 'wallet/credits',
        Reviews: 'reviews/:userId',
        MediaLibrary: 'media',
        AdminModeration: 'admin/moderation',
        Availability: 'availability',
        ModelRelease: 'legal/release',
        PayoutMethods: 'payout/methods',
      },
    },
  };

  return (
    <NavigationContainer
      linking={linking}
      theme={{
        ...DefaultTheme,
        colors: { ...DefaultTheme.colors, background: '#f7f7fb' },
      }}
    >
      <GlobalRequestManager />
      <Stack.Navigator
        screenOptions={{
          headerTitle: () =>
            logoSource ? (
              <Image source={logoSource} style={{ width: 120, height: 40, resizeMode: 'contain' }} />
            ) : undefined,
        }}
      >
        {!currentUser ? (
          // Unauthenticated Stack
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        ) : (
          // Authenticated Stack
          <>
            {(() => {
              const role = currentUser.role;
              const ageVerified = currentUser.age_verified === true;
              const requiresKyc = role === 'photographer' || role === 'model';
              const kycStatus = currentUser.kyc_status ?? (currentUser.verified ? 'approved' : 'pending');

              if (!ageVerified) {
                return <Stack.Screen name="AgeVerification" component={AgeVerificationScreen} options={{ headerShown: false }} />;
              }

              if (requiresKyc && kycStatus === 'rejected') {
                return <Stack.Screen name="PendingVerification" component={VerificationRejectedScreen} options={{ headerShown: false }} />;
              }

              if (requiresKyc && kycStatus !== 'approved') {
                return <Stack.Screen name="PendingVerification" component={PendingVerificationScreen} options={{ headerShown: false }} />;
              }

              if (!currentUser.role || (currentUser.role as string) === 'guest') {
                return <Stack.Screen name="RoleSelection" component={RoleSelectionScreen} options={{ headerShown: false }} />;
              }

              return <Stack.Screen name="Root" component={TabsNavigator} options={{ headerShown: false }} />;
            })()}
            <Stack.Screen name="AgeVerification" component={AgeVerificationScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Profile" component={UserProfileScreen} options={{ title: 'Photographer Profile' }} />
            <Stack.Screen name="BookingForm" component={BookingFormScreen} options={{ title: 'Booking Request' }} />
            <Stack.Screen name="BookingDetail" component={BookingDetailScreen} options={{ title: 'Booking Detail' }} />
            <Stack.Screen name="BookingTracking" component={BookingTrackingScreen} options={{ title: 'Track Booking' }} />
            <Stack.Screen name="Payment" component={PaymentScreen} options={{ title: 'Payments' }} />
            <Stack.Screen name="PostDetail" component={PostDetailScreen} options={{ title: 'Post' }} />
            <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'New Post' }} />
            <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Photographer Profile' }} />
            <Stack.Screen name="Compliance" component={ComplianceScreen} options={{ title: 'Privacy & Permissions' }} />
            <Stack.Screen name="ChatThread" component={ChatScreen} options={{ title: 'Chat' }} />
            <Stack.Screen name="PaidVideoCall" component={PaidVideoCallScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="PaymentHistory" component={PaymentHistoryScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Support" component={SupportScreen} options={{ headerShown: false }} />
            <Stack.Screen name="EarningsDashboard" component={EarningsDashboardScreen} options={{ headerShown: false }} />
            <Stack.Screen name="CreatorAnalytics" component={CreatorAnalyticsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="CreatorSubscriptions" component={CreatorSubscriptionsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="CreditsWallet" component={CreditsWalletScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Reviews" component={ReviewsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="MediaLibrary" component={MediaLibraryScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Legal" component={LegalScreen} options={{ headerShown: false }} />
            <Stack.Screen name="AdminModeration" component={AdminModerationScreen} options={{ headerShown: false, presentation: 'modal' }} />
            <Stack.Screen name="Availability" component={AvailabilityScreen} options={{ title: 'Manage Availability' }} />
            <Stack.Screen name="AccountConfig" component={AccountConfigScreen} options={{ title: 'Account Settings' }} />
            <Stack.Screen name="ModelRelease" component={ModelReleaseScreen} options={{ title: 'Legal Documents' }} />
            <Stack.Screen name="PayoutMethods" component={PayoutMethodsScreen} options={{ title: 'Payout Methods' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
