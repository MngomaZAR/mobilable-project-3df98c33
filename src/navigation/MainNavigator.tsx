import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DefaultTheme, useNavigation } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Image, ImageSourcePropType } from 'react-native';
import HomeScreen from '../screens/HomeScreen';
import ProfileScreen from '../screens/ProfileScreen';
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
import { RootStackParamList, TabParamList } from './types';
import { useAppData } from '../store/AppDataContext';
import AccessDeniedScreen from '../screens/AccessDeniedScreen';
import { UserRole } from '../types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createStackNavigator<RootStackParamList>();

type MainNavigatorProps = {
  logoSource?: ImageSourcePropType;
};

type GuardedRouteProps = {
  component: React.ComponentType<any>;
  routeProps: any;
  requireAuth?: boolean;
  allowedRoles?: UserRole[];
  authMessage?: string;
  roleMessage?: string;
};

const GuardedRoute: React.FC<GuardedRouteProps> = ({
  component: Component,
  routeProps,
  requireAuth = false,
  allowedRoles,
  authMessage = 'Sign in to continue.',
  roleMessage = 'Your current account role cannot access this screen.',
}) => {
  const { currentUser } = useAppData();
  const navigation = useNavigation<any>();

  if (requireAuth && !currentUser) {
    return (
      <AccessDeniedScreen
        title="Sign in required"
        message={authMessage}
        actionLabel="Go to sign in"
        onAction={() => navigation.navigate('Auth')}
      />
    );
  }

  if (allowedRoles && (!currentUser || !allowedRoles.includes(currentUser.role))) {
    return (
      <AccessDeniedScreen
        title="Access restricted"
        message={roleMessage}
        actionLabel="Back to dashboard"
        onAction={() => navigation.navigate('Root', { screen: 'Home' })}
      />
    );
  }

  return <Component {...routeProps} />;
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
  const { currentUser } = useAppData();
  const role = currentUser?.role ?? 'client';
  const homeComponent =
    role === 'photographer'
      ? PhotographerDashboardScreen
      : role === 'admin'
        ? AdminDashboardScreen
        : HomeScreen;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => tabBarIcon(route.name, focused, color, size),
        tabBarActiveTintColor: '#111827',
        tabBarInactiveTintColor: '#9ca3af',
        headerShown: false,
      })}
    >
      <Tab.Screen
        name="Home"
        children={(props) => (
          <GuardedRoute
            component={homeComponent}
            routeProps={props}
          />
        )}
        options={{ tabBarLabel: role === 'client' ? 'Home' : 'Dashboard' }}
      />
      <Tab.Screen
        name="Bookings"
        children={(props) => (
          <GuardedRoute
            component={BookingsScreen}
            routeProps={props}
            requireAuth
            authMessage="Sign in to view your bookings and payment status."
          />
        )}
      />
      <Tab.Screen name="Feed" children={(props) => <GuardedRoute component={FeedScreen} routeProps={props} />} />
      <Tab.Screen
        name="Chat"
        children={(props) => (
          <GuardedRoute
            component={ConversationsListScreen}
            routeProps={props}
            requireAuth
            authMessage="Sign in to access conversations."
          />
        )}
      />
      <Tab.Screen name="Map" children={(props) => <GuardedRoute component={MapScreen} routeProps={props} />} />
      <Tab.Screen name="Settings" children={(props) => <GuardedRoute component={SettingsScreen} routeProps={props} />} />
    </Tab.Navigator>
  );
};

export const MainNavigator: React.FC<MainNavigatorProps> = ({ logoSource }) => (
  <NavigationContainer
    theme={{
      ...DefaultTheme,
      colors: { ...DefaultTheme.colors, background: '#f7f7fb' },
    }}
  >
    <Stack.Navigator
      screenOptions={{
        headerTitle: () =>
          logoSource ? (
            <Image source={logoSource} style={{ width: 120, height: 40, resizeMode: 'contain' }} />
          ) : undefined,
      }}
    >
      <Stack.Screen name="Root" component={TabsNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="Profile" children={(props) => <GuardedRoute component={ProfileScreen} routeProps={props} />} options={{ title: 'Photographer' }} />
      <Stack.Screen
        name="BookingForm"
        children={(props) => (
          <GuardedRoute
            component={BookingFormScreen}
            routeProps={props}
            requireAuth
            allowedRoles={['client', 'admin']}
            authMessage="Sign in to request a booking."
            roleMessage="Only clients and admins can create bookings."
          />
        )}
        options={{ title: 'Booking Request' }}
      />
      <Stack.Screen
        name="BookingDetail"
        children={(props) => <GuardedRoute component={BookingDetailScreen} routeProps={props} requireAuth authMessage="Sign in to view booking details." />}
        options={{ title: 'Booking Detail' }}
      />
      <Stack.Screen
        name="BookingTracking"
        children={(props) => <GuardedRoute component={BookingTrackingScreen} routeProps={props} requireAuth authMessage="Sign in to track this booking." />}
        options={{ title: 'Track Booking' }}
      />
      <Stack.Screen
        name="Payment"
        children={(props) => (
          <GuardedRoute
            component={PaymentScreen}
            routeProps={props}
            requireAuth
            allowedRoles={['client', 'admin']}
            authMessage="Sign in to continue with payment."
            roleMessage="Only clients and admins can open the checkout screen."
          />
        )}
        options={{ title: 'Payments' }}
      />
      <Stack.Screen name="PostDetail" children={(props) => <GuardedRoute component={PostDetailScreen} routeProps={props} />} options={{ title: 'Post' }} />
      <Stack.Screen
        name="CreatePost"
        children={(props) => <GuardedRoute component={CreatePostScreen} routeProps={props} requireAuth authMessage="Sign in to create a post." />}
        options={{ title: 'New Post' }}
      />
      <Stack.Screen name="UserProfile" children={(props) => <GuardedRoute component={UserProfileScreen} routeProps={props} />} options={{ title: 'Photographer Profile' }} />
      <Stack.Screen name="Auth" component={AuthScreen} options={{ title: 'Sign in' }} />
      <Stack.Screen
        name="Compliance"
        children={(props) => <GuardedRoute component={ComplianceScreen} routeProps={props} requireAuth authMessage="Sign in to manage privacy and permissions." />}
        options={{ title: 'Privacy & Permissions' }}
      />
      <Stack.Screen
        name="ChatThread"
        children={(props) => <GuardedRoute component={ChatScreen} routeProps={props} requireAuth authMessage="Sign in to open this conversation." />}
        options={{ title: 'Chat' }}
      />
    </Stack.Navigator>
  </NavigationContainer>
);
