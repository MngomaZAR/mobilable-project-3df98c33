import { NavigatorScreenParams } from '@react-navigation/native';
import { Booking, Photographer, Post } from '../types';

export type TabParamList = {
  Home: { searchTag?: string } | undefined;
  Bookings: undefined;
  Feed: undefined;
  Chat: undefined;
  Map: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Root: NavigatorScreenParams<TabParamList>;
  Profile: { userId: string; photographer?: Photographer };
  BookingForm: { photographerId?: string; modelId?: string };
  BookingDetail: { bookingId: string };
  BookingTracking: { bookingId: string };
  Payment: { bookingId: string; dispatchIntent?: {
    serviceType: 'photography' | 'modeling' | 'combined' | 'video_call';
    fanoutCount: number;
    intensityLevel: number;
    baseAmount: number;
    requestedLat?: number;
    requestedLng?: number;
    tierId?: string;
    locationLabel?: string;
    equipment?: Record<string, string[]>;
  } };
  PostDetail: { postId: string };
  CreatePost: undefined;
  UserProfile: { userId: string; photographer?: Photographer };
  Auth: undefined;
  AgeVerification: undefined;
  PendingVerification: undefined;
  RoleSelection: undefined;
  Compliance: undefined;
  ChatThread: { conversationId: string; title?: string; avatarUrl?: string };
  AccountConfig: undefined;
  ModelPremiumDashboard: undefined;
  PaidVideoCall: { creatorId?: string; role?: 'creator' | 'viewer'; testRoom?: boolean } | undefined;
  Notifications: undefined;
  PaymentHistory: undefined;
  Support: undefined;
  EarningsDashboard: undefined;
  CreatorSubscriptions: { creatorId: string };
  Reviews: { photographerId: string };
  MediaLibrary: { creatorId: string; title?: string };
  AdminModeration: undefined;
  Availability: undefined;
  ModelRelease: { bookingId: string };
  Legal: { title: string; content: string };
  CreditsWallet: undefined;
  CreatorAnalytics: undefined;
  PayoutMethods: undefined;
  KYC: undefined;
  EquipmentSetup: undefined;
  ModelServices: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
