import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
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
import ChatScreen from '../screens/ChatScreen';
import UserProfileScreen from '../screens/UserProfileScreen';
import MapScreen from '../screens/MapScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AuthScreen from '../screens/AuthScreen';
import BookingTrackingScreen from '../screens/BookingTrackingScreen';
import PaymentScreen from '../screens/PaymentScreen';
import ComplianceScreen from '../screens/ComplianceScreen';
import { RootStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createStackNavigator<RootStackParamList>();

type MainNavigatorProps = {
  logoSource?: ImageSourcePropType;
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

const TabsNavigator = () => (
  <Tab.Navigator
    screenOptions={({ route }) => ({
      tabBarIcon: ({ focused, color, size }) => tabBarIcon(route.name, focused, color, size),
      tabBarActiveTintColor: '#111827',
      tabBarInactiveTintColor: '#9ca3af',
      headerShown: false,
    })}
  >
    <Tab.Screen name="Home" component={HomeScreen} />
    <Tab.Screen name="Bookings" component={BookingsScreen} />
    <Tab.Screen name="Feed" component={FeedScreen} />
    <Tab.Screen name="Chat" component={ConversationsListScreen} />
    <Tab.Screen name="Map" component={MapScreen} />
    <Tab.Screen name="Settings" component={SettingsScreen} />
  </Tab.Navigator>
);

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
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Photographer' }} />
      <Stack.Screen name="BookingForm" component={BookingFormScreen} options={{ title: 'Booking Request' }} />
      <Stack.Screen name="BookingDetail" component={BookingDetailScreen} options={{ title: 'Booking Detail' }} />
      <Stack.Screen name="BookingTracking" component={BookingTrackingScreen} options={{ title: 'Track Booking' }} />
      <Stack.Screen name="Payment" component={PaymentScreen} options={{ title: 'Payments' }} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} options={{ title: 'Post' }} />
      <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'New Post' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Photographer Profile' }} />
      <Stack.Screen name="Auth" component={AuthScreen} options={{ title: 'Sign in' }} />
      <Stack.Screen name="Compliance" component={ComplianceScreen} options={{ title: 'Privacy & Permissions' }} />
      <Stack.Screen name="ChatThread" component={ChatScreen} options={{ title: 'Chat' }} />
    </Stack.Navigator>
  </NavigationContainer>
);
