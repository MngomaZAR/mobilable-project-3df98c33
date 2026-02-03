import { NavigatorScreenParams } from '@react-navigation/native';
import { Booking, Photographer, Post } from '../types';

export type TabParamList = {
  Home: undefined;
  Bookings: undefined;
  Feed: undefined;
  Chat: { conversationId?: string; title?: string } | undefined;
  Map: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Root: NavigatorScreenParams<TabParamList>;
  Profile: { photographerId: string };
  BookingForm: { photographerId: string };
  BookingDetail: { bookingId: string };
  BookingTracking: { bookingId: string };
  Payment: { bookingId?: string };
  PostDetail: { postId: string };
  CreatePost: undefined;
  UserProfile: { userId: string; photographer?: Photographer };
  Auth: undefined;
  Compliance: undefined;
  ChatThread: { conversationId: string; title?: string };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
