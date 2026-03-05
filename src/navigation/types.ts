import { NavigatorScreenParams } from '@react-navigation/native';
import { Booking, Photographer, Post } from '../types';

export type TabParamList = {
  Home: undefined;
  Bookings: undefined;
  Feed: undefined;
  Chat: { conversationId?: string; title?: string } | undefined;
  Map: undefined;
  Requests: undefined;
  Earnings: undefined;
  Portfolio: undefined;
  Calendar: undefined;
  AdminOps: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Root: NavigatorScreenParams<TabParamList>;
  Profile: { photographerId: string };
  BookingForm: { photographerId: string };
  BookingDetail: { bookingId: string };
  BookingTracking: { bookingId: string };
  Payment: { bookingId?: string };
  PostDetail: { postId: string; post?: Post };
  CreatePost: undefined;
  UserProfile: { userId: string; photographer?: Photographer };
  Auth: undefined;
  Compliance: undefined;
  Support: undefined;
  Report: { targetType: 'post' | 'user'; targetId: string; title?: string };
  PrivacyPolicy: undefined;
  Terms: undefined;
  AccountDelete: undefined;
  ChatThread: { conversationId: string; title?: string };
  PhotographerDashboard: undefined;
  AdminDashboard: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
