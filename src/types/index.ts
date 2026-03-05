export type BookingStatus = 'pending' | 'accepted' | 'completed' | 'reviewed';

export type UserRole = 'client' | 'photographer' | 'admin';

export type PricingMode = 'paparazzi' | 'event';

export type EventPackage = {
  id: string;
  label: string;
  basePrice: number;
  durationHours: number;
};

export type CommissionBreakdown = {
  gross: number;
  commissionRate: number;
  commissionAmount: number;
  photographerPayout: number;
};

export type PricingQuote = {
  mode: PricingMode;
  photographerId: string;
  distanceKm: number;
  rating: number;
  basePrice: number;
  distanceFee: number;
  ratingMultiplier: number;
  subtotal: number;
  commission: CommissionBreakdown;
  total: number;
  currency: string;
  metadata?: Record<string, string | number | boolean>;
};

export type RecommendationScore = {
  photographerId: string;
  distanceKm: number;
  ratingScore: number;
  availabilityScore: number;
  responseScore: number;
  totalScore: number;
};

export const PRICING_CONFIG = {
  currency: 'ZAR',
  commissionRate: 0.3,
  paparazzi: {
    basePerPhoto: 10,
    distanceFeePerKm: 0.75,
    ratingMultiplier: {
      low: 0.9,
      mid: 1.0,
      high: 1.15,
      elite: 1.3,
    },
  },
  eventPackages: [
    { id: 'birthday', label: 'Birthday', basePrice: 250, durationHours: 2 },
    { id: 'wedding', label: 'Wedding', basePrice: 900, durationHours: 6 },
    { id: 'corporate', label: 'Corporate', basePrice: 600, durationHours: 4 },
  ] as EventPackage[],
};

export interface AppUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface PrivacySettings {
  marketingOptIn: boolean;
  personalizedAds: boolean;
  dataDeletionRequestedAt: string | null;
  locationEnabled: boolean;
}

export interface Photographer {
  id: string;
  name: string;
  style: string;
  location: string;
  latitude: number;
  longitude: number;
  avatar: string;
  bio: string;
  rating: number;
  priceRange: string;
  tags: string[];
  isAvailable?: boolean;
}

export interface Booking {
  id: string;
  photographerId: string;
  date: string;
  package: string;
  notes?: string;
  status: BookingStatus;
  createdAt: string;
  pricingMode?: PricingMode;
  priceTotal?: number;
  currency?: string;
  userLatitude?: number;
  userLongitude?: number;
}

export interface Message {
  id: string;
  chatId: string;
  fromUser: boolean;
  text: string;
  timestamp: string;
}

export interface Post {
  id: string;
  userId: string;
  imageUri: string;
  caption: string;
  createdAt: string;
  location?: string;
  likes: number;
  liked: boolean;
  commentCount: number;
}

export interface Comment {
  id: string;
  postId: string;
  userId: string;
  text: string;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  lastMessageAt: string | null;
}

export interface AppState {
  photographers: Photographer[];
  bookings: Booking[];
  conversations: ConversationSummary[];
  messages: Message[];
  posts: Post[];
  comments: Comment[];
  currentUser: AppUser | null;
  privacy: PrivacySettings;
}
