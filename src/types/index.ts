// Mirrors the bookings.status check constraint in Supabase exactly.
// 'in_progress' and 'reviewed' are client-side display aliases only.
export type BookingStatus =
  | 'pending'
  | 'accepted'
  | 'in_progress'  // client-side alias — not stored in DB
  | 'completed'
  | 'reviewed'     // client-side alias — not stored in DB
  | 'cancelled'
  | 'declined'
  | 'paid_out';    // terminal state after escrow payout
export type AssignmentState = 'queued' | 'offered' | 'accepted' | 'expired' | 'cancelled';
export type UserGender = 'female' | 'male' | 'non_binary' | 'prefer_not_to_say' | null;

export type UserRole = 'client' | 'photographer' | 'model' | 'admin' | null;

export type EquipmentProfile = {
  camera: string[];
  lenses: string[];
  lighting: string[];
  extras: string[];
};

export interface AppUser {
  id: string;
  email: string;
  role: UserRole;
  is_photographer?: boolean;
  is_model?: boolean;
  is_test_account?: boolean;
  gender?: UserGender;
  verified?: boolean;
  kyc_status?: 'pending' | 'submitted' | 'approved' | 'rejected' | null;
  date_of_birth?: string | null;
  age_verified?: boolean;
  age_verified_at?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  phone?: string | null;
  push_token?: string | null;
  city?: string | null;
  username?: string | null;
  website?: string | null;
  instagram?: string | null;
  contact_details?: Record<string, any>;
}

export type ProfileSummary = {
  id: string;
  full_name: string | null;
  city: string | null;
  avatar_url: string | null;
  bio?: string | null;
  username?: string | null;
  verified?: boolean;
  kyc_status?: AppUser['kyc_status'];
  age_verified?: boolean | null;
};

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
  avatar_url: string;
  bio: string;
  rating: number;
  price_range: string;
  tags: string[];
  tier_id?: string | null;
  equipment?: EquipmentProfile | null;
  /** ZAR per hour */
  hourly_rate?: number | null;
  experience_years?: number | null;
  specialties?: string[] | null;
  phone?: string | null;
  portfolio_urls?: string[] | null;
  subscription_tiers?: SubscriptionTier[];
  website?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  is_online?: boolean;
  pinned_post_ids?: string[] | null;
  created_at?: string;
}

export interface SubscriptionTier {
  id: string;
  name: string;
  price_zar: number;
  benefits: string[];
}

export interface Model {
  id: string;
  name: string;
  style: string;
  location: string;
  latitude: number;
  longitude: number;
  avatar_url: string;
  bio: string;
  rating: number;
  price_range: string;
  tags: string[];
  portfolio_urls: string[];
  tier_id?: string | null;
  equipment?: EquipmentProfile | null;
  experience_years?: number | null;
  website?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  is_online?: boolean;
  specialties?: string[] | null;
  hourly_rate?: number | null;
  pinned_post_ids?: string[] | null;
  created_at?: string;
}

export interface Booking {
  id: string;
  photographer_id: string;
  client_id: string;
  model_id?: string | null;
  service_type?: 'photography' | 'modeling' | 'combined';
  booking_date: string;
  start_datetime?: string; // ISODateString
  end_datetime?: string;   // ISODateString
  duration_hours?: number | null;
  pricing_mode?: string | null;
  package_type: string;
  package_id?: string;
  notes?: string;
  status: BookingStatus;
  created_at: string;
  user_latitude?: number | null;
  user_longitude?: number | null;
  total_amount: number;
  commission_amount: number;
  payout_amount: number;
  currency?: string;
  fanout_count?: number | null;
  intensity_level?: number | null;
  quote_token?: string | null;
  assignment_state?: AssignmentState | null;
  eta_confidence?: number | null;
  dispatch_request_id?: string | null;
  photographer?: { id: string; name: string; avatar_url: string; city: string | null };
  client?: { id: string; name: string; avatar_url: string; city: string | null };
}

export interface DispatchRequest {
  id: string;
  booking_id?: string | null;
  client_id: string;
  service_type: 'photography' | 'modeling' | 'combined' | 'video_call';
  fanout_count: number;
  intensity_level: number;
  sla_timeout_seconds: number;
  status: AssignmentState;
  assignment_profile_id?: string | null;
  quote_token?: string | null;
  requested_lat?: number | null;
  requested_lng?: number | null;
  price_base?: number | null;
  price_multiplier?: number | null;
  price_estimate?: number | null;
  expires_at?: string | null;
  accepted_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface DispatchOffer {
  id: string;
  dispatch_request_id: string;
  provider_id: string;
  offer_rank: number;
  status: 'offered' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  idempotency_key?: string | null;
  responded_at?: string | null;
  created_at: string;
}

export interface PricingQuote {
  id: string;
  quote_token: string;
  fanout_count: number;
  intensity_level: number;
  base_amount: number;
  surge_multiplier: number;
  intensity_multiplier: number;
  total_amount: number;
  currency: string;
  status: 'preview' | 'accepted' | 'expired' | 'cancelled';
  expires_at?: string | null;
  created_at: string;
}

export interface EtaSnapshot {
  booking_id: string;
  eta_seconds: number;
  eta_minutes: number;
  eta_confidence: number;
  distance_km?: number | null;
  source: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  full_name: string;
  seen_score: number;
  scene_rank: number;
  badges?: string[];
  avatar_url?: string | null;
  city?: string | null;
  role?: UserRole;
}

export interface Message {
  id: string;
  conversation_id: string;
  from_user: boolean;
  body: string;
  timestamp: string;
  message_type?: string;
  media_url?: string | null;
  preview_url?: string | null;
  locked?: boolean;
  unlocked?: boolean;
  unlock_booking_id?: string | null;
  unlock_price?: number | null;
  read_at?: string | null;
  reply_to_id?: string | null;
  reply_preview?: string | null;
  audio_url?: string | null;
  audio_duration_seconds?: number | null;
}

export interface Post {
  id: string;
  author_id: string;
  image_url: string;
  video_url?: string | null;
  media_type?: string | null;
  caption: string;
  created_at: string;
  location?: string;
  likes_count: number;
  liked: boolean;
  comment_count: number;
  profile?: ProfileSummary;
  is_locked?: boolean;
  price?: number;
  is_premium?: boolean;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profile?: ProfileSummary;
}

export interface ConversationSummary {
  id: string;
  title: string;
  last_message?: string | null;
  last_message_at: string | null;
  created_at?: string | null;
  participants?: string[];
  participant?: { id: string; name: string; avatar_url: string; last_active_at?: string | null };
}

export interface Review {
  id: string;
  booking_id: string;
  client_id: string;
  photographer_id: string;
  rating: number;
  comment: string | null;
  moderation_status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  client?: ProfileSummary;
}

export interface Payment {
  id: string;
  booking_id: string;
  customer_id: string;
  amount: number;
  currency: string;
  description: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  provider: string;
  provider_payment_id: string | null;
  created_at: string;
  processed_at: string | null;
  payment_type?: 'booking' | 'tip' | 'subscription' | 'video_call';
}

export interface Subscription {
  id: string;
  creator_id: string;
  subscriber_id: string;
  tier_id: string;
  status: 'active' | 'cancelled' | 'expired';
  current_period_start: string;
  current_period_end: string;
}

export interface Tip {
  id: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  message?: string;
  created_at: string;
}

export interface Earning {
  id: string;
  user_id: string;
  amount: number;
  source_type: 'booking' | 'tip' | 'subscription' | 'video_call';
  source_id: string;
  created_at: string;
}

export interface NotificationEvent {
  id: string;
  user_id: string;
  event_type: 'booking_confirmed' | 'new_message';
  title: string;
  body: string;
  data: Record<string, any>;
  status: 'queued' | 'sent' | 'failed';
  created_at: string;
}

export interface AppState {
  photographers: Photographer[];
  models: Model[];
  bookings: Booking[];
  conversations: ConversationSummary[];
  messages: Record<string, Message[]>; // keyed by conversation_id
  posts: Post[];
  profiles: ProfileSummary[];
  comments: Record<string, Comment[]>; // keyed by post_id
  reviews: Record<string, Review[]>;   // keyed by photographer_id
  payments: Payment[];
  subscriptions: Subscription[];
  tips: Tip[];
  earnings: Earning[];
  mediaAssets: MediaAsset[];
  creditsWallet: CreditsWallet | null;
  creditsLedger: CreditsLedgerEntry[];
  follows: Follow[];
  notifications: NotificationEvent[];
  currentUser: AppUser | null;
  privacy: PrivacySettings;
  loading: boolean;
  saving: boolean;
  authenticating: boolean;
  error: string | null;
}

export interface MediaAsset {
  id: string;
  owner_id: string;
  booking_id?: string | null;
  bucket: string;
  object_path: string;
  is_locked: boolean;
  price_zar?: number | null;
  title?: string | null;
  created_at: string;
  preview_url?: string | null;
  full_url?: string | null;
}

export interface Follow {
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface MediaAccessLog {
  id: string;
  asset_id: string;
  user_id: string;
  accessed_at: string;
}

export interface CreditsWallet {
  user_id: string;
  balance: number;
  updated_at?: string;
}

export interface CreditsLedgerEntry {
  id: string;
  user_id: string;
  amount: number;
  direction: 'credit' | 'debit';
  reason?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  created_at: string;
}
