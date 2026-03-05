export type BookingStatus = 'pending' | 'accepted' | 'completed' | 'reviewed';

export type UserRole = 'client' | 'photographer' | 'admin';

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

export interface Booking {
  id: string;
  photographerId: string;
  date: string;
  package: string;
  notes?: string;
  status: BookingStatus;
  createdAt: string;
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
  participants?: string[]; // list of user IDs
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
  loading: boolean;
  saving: boolean;
  authenticating: boolean;
  error: string | null;
}
