export type BookingStatus = 'pending' | 'accepted' | 'completed' | 'reviewed';

export type UserRole = 'client' | 'photographer' | 'model' | 'admin';

export interface AppUser {
  id: string;
  email: string;
  role: UserRole;
  verified?: boolean;
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
}

export interface Model {
  id: string;
  name: string;
  style: string;       // e.g. "Editorial", "Commercial", "Fitness"
  location: string;
  latitude: number;
  longitude: number;
  avatar: string;
  bio: string;
  rating: number;
  priceRange: string;  // e.g. "$$", "$$$"
  tags: string[];
  portfolioUrls: string[];
}

export interface Booking {
  id: string;
  photographerId: string;
  modelId?: string | null;
  serviceType?: 'photography' | 'modeling' | 'combined';
  date: string;
  package: string;
  notes?: string;
  status: BookingStatus;
  createdAt: string;
  userLatitude?: number | null;
  userLongitude?: number | null;
}

export interface Message {
  id: string;
  chatId: string;
  fromUser: boolean;
  text: string;
  timestamp: string;
  messageType?: 'text' | 'media';
  mediaUrl?: string | null;
  previewUrl?: string | null;
  locked?: boolean;
  unlocked?: boolean;
  unlockBookingId?: string | null;
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
  lastMessage?: string | null;
  lastMessageAt: string | null;
  createdAt?: string | null;
  participants?: string[];
}

export interface AppState {
  photographers: Photographer[];
  models: Model[];
  bookings: Booking[];
  conversations: ConversationSummary[];
  messages: Message[];
  posts: Post[];
  comments: Comment[];
  currentUser: AppUser | null;
  privacy: PrivacySettings;
  loading: boolean;
  saving: boolean;
  authenticating: boolean;
  error: string | null;
}
