
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialState } from '../data/initialData';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { createBookingRequest, updateBookingStatusInDb } from '../services/bookingService';
import { BUCKETS } from '../config/environment';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { AppState, AppUser, Booking, BookingStatus, Comment, ConversationSummary, Message, Model, NotificationEvent, Post, PrivacySettings, Review, UserRole, CreditsWallet, CreditsLedgerEntry } from '../types';
import { uid } from '../utils/id';
import { formatAuthError, formatErrorMessage, logError } from '../utils/errors';
import { mapPhotographerRow, mapPostRow, mapSupabaseUser } from '../utils/mappings';
import { startConversationViaEdge } from '../services/chatService';
import {
  listConversationMessages,
  sendConversationLockedMediaMessage,
  sendConversationTextMessage,
} from '../services/chatMessageService';
import { resolveStorageRef, uploadImage, uploadAvatar, uploadBlurredPreview } from '../services/uploadService';
import { fetchCreatorEarnings } from '../services/monetisationService';
import { registerForPushNotificationsAsync, savePushTokenAsync } from '../services/notificationService';
import { assertSouthAfricanLocation, DEFAULT_CAPE_TOWN_COORDINATES, ensureSouthAfricanCoordinates } from '../utils/geo';
import { recordConsent as recordComplianceConsent } from '../services/dispatchService';

type CreateBookingInput = {
  photographer_id?: string;
  talent_id?: string;
  model_id?: string;
  talent_type?: 'photographer' | 'model';
  booking_date: string;
  package_type: string;
  notes?: string;
  /** Base session price in ZAR */
  base_amount?: number;
  /** Travel / distance surcharge in ZAR (Uber-style) */
  travel_amount?: number;
  fanout_count?: number;
  intensity_level?: number;
  quote_token?: string;
  assignment_state?: Booking['assignment_state'];
  dispatch_request_id?: string | null;
  latitude?: number;
  longitude?: number;
  start_datetime?: string;
  end_datetime?: string;
};

type CreatePostInput = {
  caption: string;
  imageUri: string;
  location?: string;
  userId?: string;
};

type FetchPostsOptions = {
  reset?: boolean;
  attempt?: number;
};

type AppDataContextValue = {
  state: AppState;
  loading: boolean;
  saving: boolean;
  authenticating: boolean;
  error: string | null;
  currentUser: AppUser | null;
  refresh: () => Promise<void>;
  revalidateSession: () => Promise<AppUser | null>;
  createBooking: (payload: CreateBookingInput) => Promise<Booking>;
  updateBookingStatus: (bookingId: string, targetStatus?: BookingStatus) => Promise<Booking | undefined>;
  sendMessage: (chatId: string, text: string, fromUser?: boolean) => Promise<Message>;
  sendLockedMediaMessage: (chatId: string, payload: { mediaUrl: string; previewUrl?: string; text?: string; unlockBookingId?: string; unlockPrice?: number; }) => Promise<Message>;
  fetchMessages: (chatId: string) => Promise<void>;
  fetchMessagesForChat: (chatId: string) => Promise<void>;
  fetchComments: (postId: string) => Promise<void>;
  updateBookingClientLocation: (bookingId: string, latitude: number, longitude: number) => Promise<void>;
  updatePhotographerLocation: (latitude: number, longitude: number) => Promise<void>;
  startConversationWithUser: (participantId: string, title?: string) => Promise<{ id: string; title: string }>;
  addPost: (payload: CreatePostInput) => Promise<Post>;
  toggleLike: (postId: string) => Promise<Post | undefined>;
  addComment: (postId: string, text: string, userId?: string) => Promise<Comment>;
  fetchPosts: (options?: FetchPostsOptions) => Promise<{ hasMore: boolean }>;
  fetchProfiles: () => Promise<void>;
  fetchSubscriptions: (userId?: string | null) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    role?: AppUser['role'],
    fullName?: string,
    dob?: string,
    extras?: { gender?: AppUser['gender']; city?: string; phone?: string }
  ) => Promise<AppUser | null>;
  signIn: (email: string, password: string) => Promise<AppUser | null>;
  signInWithOAuth: (provider: 'google' | 'apple') => Promise<void>;
  signOut: () => Promise<void>;
  updatePrivacy: (changes: Partial<PrivacySettings>) => Promise<void>;
  requestDataDeletion: () => Promise<void>;
  resetState: () => Promise<void>;
  updateProfilePicture: (uri: string) => Promise<void>;
  updateProfile: (changes: Partial<AppUser>) => Promise<void>;
  updateProviderSettings: (payload: { tier_id?: string | null; equipment?: any | null }) => Promise<void>;
  fetchEarnings: (userId: string) => Promise<void>;
  fetchCredits: (userId?: string | null) => Promise<void>;
  fetchNotifications: (userId?: string | null) => Promise<void>;
  adjustCredits: (amount: number, reason?: string, refType?: string, refId?: string) => Promise<number>;
  redeemCreditsCode: (code: string) => Promise<number>;
  setState: (payload: Partial<AppState>) => void;
}

const STORAGE_KEY = 'movable-app-state-v2';
const MAX_PHOTOGRAPHERS = 120;
const MAX_FETCH_POSTS_ATTEMPTS = 2;

const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set();
  return items.filter(item => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const isRecoverableAbort = (err: unknown) => {
  const message = (err as any)?.message ?? '';
  return (err as any)?.name === 'AbortError' || /abort/i.test(String(message));
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const TIMEOUT_ERROR_MESSAGE = 'Request timed out.';
const withTimeout = async <T,>(promiseLike: PromiseLike<T>, timeoutMs = 12000): Promise<T> => {
  return await Promise.race<T>([
    Promise.resolve(promiseLike),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(TIMEOUT_ERROR_MESSAGE)), timeoutMs)),
  ]);
};
const isTimeoutError = (err: unknown) => String((err as any)?.message ?? '').includes(TIMEOUT_ERROR_MESSAGE);

const parseAuthCallbackParams = (url: string) => {
  try {
    const parsed = Linking.parse(url);
    const query = { ...(parsed.queryParams ?? {}) } as Record<string, unknown>;
    const hashIndex = url.indexOf('#');
    if (hashIndex !== -1) {
      const hashParams = new URLSearchParams(url.slice(hashIndex + 1));
      hashParams.forEach((value, key) => {
        query[key] = value;
      });
    }
    return query;
  } catch {
    return {};
  }
};
const BOOKING_SELECT = `
  id, 
  photographer_id, 
  model_id,
  client_id, 
  booking_date, 
  package_type, 
  notes, 
  status, 
  created_at, 
  user_latitude, 
  user_longitude,
  price_total,
  commission_amount,
  photographer_payout,
  fanout_count,
  intensity_level,
  quote_token,
  assignment_state,
  eta_confidence,
  dispatch_request_id
`;

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

type ProfileRow = {
  role?: AppUser['role'];
  verified?: boolean;
  kyc_status?: AppUser['kyc_status'];
  date_of_birth?: string | null;
  age_verified?: boolean | null;
  age_verified_at?: string | null;
} | null;
type BookingRow = {
  id: string;
  photographer_id: string;
  booking_date: string | null;
  package_type: string | null;
  notes: string | null;
  status: BookingStatus | null;
  created_at: string | null;
  user_latitude: number | null;
  user_longitude: number | null;
  price_total: number | null;
  commission_amount: number | null;
  photographer_payout: number | null;
  fanout_count?: number | null;
  intensity_level?: number | null;
  quote_token?: string | null;
  assignment_state?: Booking['assignment_state'] | null;
  eta_confidence?: number | null;
  dispatch_request_id?: string | null;
};

const PROFILE_SELECT = `
  id, 
  full_name, 
  avatar_url, 
  city, 
  role, 
  verified, 
  kyc_status,
  date_of_birth,
  age_verified,
  age_verified_at,
  bio, 
  phone, 
  push_token, 
  contact_details,
  username,
  instagram,
  website,
  availability_status
`;

const PHOTOGRAPHER_SELECT = `
  id,
  name,
  avatar_url,
  rating,
  location,
  latitude,
  longitude,
  price_range,
  style,
  bio,
  tags,
  tier_id,
  equipment,
  is_available,
  hourly_rate,
  experience_years,
  specialties
`;

const mapBookingRow = (row: any): Booking => ({
  id: row.id,
  photographer_id: row.photographer_id,
  model_id: row.model_id ?? null,
  client_id: row.client_id,
  booking_date: row.booking_date ?? '',
  package_type: row.package_type ?? 'Photography booking',
  notes: row.notes ?? '',
  status: (row.status ?? 'pending') as BookingStatus,
  created_at: row.created_at ?? new Date().toISOString(),
  user_latitude: row.user_latitude ?? null,
  user_longitude: row.user_longitude ?? null,
  total_amount: Number(row.total_amount || row.price_total || 0),
  commission_amount: Number(row.commission_amount || 0),
  payout_amount: Number(row.photographer_payout || 0),
  fanout_count: row.fanout_count ?? 1,
  intensity_level: row.intensity_level ?? 1,
  quote_token: row.quote_token ?? null,
  assignment_state: row.assignment_state ?? 'queued',
  eta_confidence: row.eta_confidence ?? null,
  dispatch_request_id: row.dispatch_request_id ?? null,
  photographer: row.photographer ? {
    id: row.photographer.id,
    name: row.photographer.full_name,
    avatar_url: row.photographer.avatar_url,
    city: row.photographer.city
  } : undefined,
  client: row.client ? {
    id: row.client.id,
    name: row.client.full_name,
    avatar_url: row.client.avatar_url,
    city: row.client.city
  } : undefined
});

// REDUCER

type Action = 
  | { type: 'SET_STATE', payload: Partial<AppState> }
  | { type: 'SET_LOADING', payload: boolean }
  | { type: 'SET_SAVING', payload: boolean }
  | { type: 'SET_AUTHENTICATING', payload: boolean }
  | { type: 'SET_ERROR', payload: string | null };

const appReducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'SET_STATE': {
      const payload = action.payload;
      const nextState = { ...state, ...payload };
      
      // Automatic Deduplication for lists
      if (payload.posts) nextState.posts = dedupeById(payload.posts);
      if (payload.bookings) nextState.bookings = dedupeById(payload.bookings);
      if (payload.conversations) nextState.conversations = dedupeById(payload.conversations);
      if (payload.profiles) nextState.profiles = dedupeById(payload.profiles);
      if (payload.photographers) nextState.photographers = dedupeById(payload.photographers);
      if (payload.models) nextState.models = dedupeById(payload.models);
      if (payload.mediaAssets) nextState.mediaAssets = dedupeById(payload.mediaAssets);
      if (payload.earnings) nextState.earnings = dedupeById(payload.earnings);
      if (payload.tips) nextState.tips = dedupeById(payload.tips);
      if (payload.subscriptions) nextState.subscriptions = dedupeById(payload.subscriptions);
      
      if (payload.messages) {
        const nextMessages = { ...state.messages, ...payload.messages };
        Object.keys(payload.messages).forEach(chatId => {
          if (nextMessages[chatId]) nextMessages[chatId] = dedupeById(nextMessages[chatId]);
        });
        nextState.messages = nextMessages;
      }
      
      return nextState;
    }
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_SAVING':
        return { ...state, saving: action.payload };
    case 'SET_AUTHENTICATING':
        return { ...state, authenticating: action.payload };
    case 'SET_ERROR':
        return { ...state, error: action.payload };
    default:
      return state;
  }
};

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setState = useCallback((payload: Partial<AppState>) => dispatch({ type: 'SET_STATE', payload }), []);
  const setLoading = (payload: boolean) => dispatch({ type: 'SET_LOADING', payload });
  const setSaving = (payload: boolean) => dispatch({ type: 'SET_SAVING', payload });
  const setAuthenticating = (payload: boolean) => dispatch({ type: 'SET_AUTHENTICATING', payload });
  const setError = (payload: string | null) => dispatch({ type: 'SET_ERROR', payload });

  const fetchProfile = useCallback(async (userId: string): Promise<ProfileRow> => {
    if (!hasSupabase) return null;
    if (__DEV__) console.log('Fetching profile for:', userId);
    try {
      const { data, error } = await supabase.from('profiles').select(PROFILE_SELECT).eq('id', userId).maybeSingle();
      if (error) throw error;
      if (__DEV__) console.log('Profile fetch result:', data);
      return (data as any) ?? null;
    } catch (err) {
      logError('fetchProfile', err);
      return null;
    }
  }, []);

  const fetchPhotographers = useCallback(async () => {
    if (!hasSupabase) return;
    try {
      const { data: rawPhotographers, error: photographerError } = await supabase
        .from('photographers')
        .select(PHOTOGRAPHER_SELECT)
        .limit(MAX_PHOTOGRAPHERS)
        .order('rating', { ascending: false });
      
      if (photographerError) throw photographerError;

      const profileIds = [...new Set((rawPhotographers ?? []).map((p: any) => p.id).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      if (profileIds.length > 0) {
        const { data: profilesData } = await supabase.from('profiles').select(PROFILE_SELECT).in('id', profileIds);
        (profilesData ?? []).forEach((p: any) => { profilesMap[p.id] = p; });
      }

      const photographers = (rawPhotographers ?? []).map((row: any) => {
        row.profiles = profilesMap[row.id];
        return mapPhotographerRow(row);
      }).slice(0, MAX_PHOTOGRAPHERS);

      setState({ photographers });
    } catch (err: any) {
      const message = formatErrorMessage(err, 'Unable to load photographers right now.');
      if (!/failed to fetch|network/i.test(message) && stateRef.current.photographers.length === 0) {
        logError('fetch_photographers', err);
        setError(message);
      } else {
        console.warn('Network offline, using cached photographers.');
      }
    }
  }, []);

  const fetchModels = useCallback(async () => {
    if (!hasSupabase) return;
    try {
      const { data: rawModels, error: modelError } = await supabase
        .from('models')
        .select(`
          id,
          rating,
          location,
          latitude,
          longitude,
          price_range,
          style,
          bio,
          tags,
          portfolio_urls,
          tier_id,
          equipment
        `)
        .limit(MAX_PHOTOGRAPHERS)
        .order('rating', { ascending: false });
        
      if (modelError) throw modelError;

      const profileIds = [...new Set((rawModels ?? []).map((m: any) => m.id).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      if (profileIds.length > 0) {
        const { data: profilesData } = await supabase.from('profiles').select(PROFILE_SELECT).in('id', profileIds);
        (profilesData ?? []).forEach((p: any) => { profilesMap[p.id] = p; });
      }
      
      const mapped = (rawModels ?? []).map((row: any) => {
        row.profiles = profilesMap[row.id];
        return {
        id: row.id,
        name: row.profiles?.full_name ?? 'Model',
        style: row.style ?? 'Generic',
        location: row.location ?? row.profiles?.city ?? 'Unknown',
        latitude: row.latitude ?? 0,
        longitude: row.longitude ?? 0,
        avatar_url: row.profiles?.avatar_url ?? '',
        bio: row.bio ?? '',
        rating: row.rating ?? 5.0,
        price_range: row.price_range ?? '$$',
        tags: row.tags ?? [],
        portfolio_urls: row.portfolio_urls ?? [],
        tier_id: row.tier_id ?? null,
        equipment: row.equipment ?? null,
      };
      });

      setState({ models: mapped });
    } catch (err: any) {
      console.warn('Network offline, using cached models.');
    }
  }, []);

  const fetchBookings = useCallback(
    async (userId?: string | null) => {
      if (!hasSupabase) return;
      const targetUserId = userId ?? stateRef.current.currentUser?.id;
      if (!targetUserId) {
        setState({ bookings: [] });
        return;
      }

      try {
        const { data: rawBookings, error } = await supabase
          .from('bookings')
          .select(BOOKING_SELECT)
          .or(`client_id.eq.${targetUserId},photographer_id.eq.${targetUserId},model_id.eq.${targetUserId}`)
          .order('created_at', { ascending: false })
          .limit(80);

        if (error) throw error;

        // Manual Join to Avoid Supabase FK Errors
        const profileIds = [...new Set(
          (rawBookings ?? []).flatMap((b: any) => [b.client_id, b.photographer_id, b.model_id]).filter(Boolean)
        )];
        let profilesMap: Record<string, any> = {};
        if (profileIds.length > 0) {
          const { data: profilesData } = await supabase
            .from('profiles')
            .select(PROFILE_SELECT)
            .in('id', profileIds);
          (profilesData ?? []).forEach((p: any) => { profilesMap[p.id] = p; });
        }

        const bookings = (rawBookings ?? []).map((row: any) => {
          row.photographer = profilesMap[row.photographer_id];
          row.client = profilesMap[row.client_id];
          return mapBookingRow(row as BookingRow);
        });
        setState({ bookings });
      } catch (err: any) {
        const message = formatErrorMessage(err, `Error loading bookings: ${err?.message || 'Unknown error'}`);
        if (!/failed to fetch|network/i.test(message) && stateRef.current.bookings.length === 0) {
          logError('fetch_bookings', err);
          setError(message);
        } else {
          console.warn('Network offline, using cached bookings.');
        }
      }
    },
    []
  );

  const fetchPosts = useCallback(async ({ reset = true, attempt = 0 }: FetchPostsOptions = {}): Promise<{ hasMore: boolean }> => {
    if (!hasSupabase) return { hasMore: false };
    setError(null);
    try {
      const start = reset ? 0 : stateRef.current.posts.length;
      const end = start + 11; // Fetch 12 at a time

        const { data: rawPosts, error: postError } = await withTimeout(
          supabase
            .from('posts')
            .select(`
              id, author_id, caption, location, comment_count, created_at, image_url, likes_count
            `)
            .order('created_at', { ascending: false })
            .range(start, end)
        );

      if (postError) throw postError;

      const profileIds = [...new Set((rawPosts ?? []).map((p: any) => p.author_id).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      if (profileIds.length > 0) {
          const { data: profilesData } = await withTimeout(
            supabase.from('profiles').select('id, full_name, city, avatar_url').in('id', profileIds)
          );
        (profilesData ?? []).forEach((p: any) => { profilesMap[p.id] = p; });
      }

      let mapped = await Promise.all(
        (rawPosts ?? []).map(async (post: any) => {
          post.image_url = await resolveStorageRef(post.image_url ?? '', BUCKETS.posts);
          post.profiles = profilesMap[post.author_id] ? [profilesMap[post.author_id]] : [];
          return mapPostRow(post);
        })
      );

      // Resolve liked state if user is logged in
      const currentUserId = stateRef.current.currentUser?.id;
      if (currentUserId && mapped.length > 0) {
        const postIds = mapped.map(p => p.id);
          const { data: likesData } = await withTimeout(
            supabase
              .from('post_likes')
              .select('post_id')
              .eq('user_id', currentUserId)
              .in('post_id', postIds)
          );
        
        if (likesData) {
          const likedSet = new Set(likesData.map(l => l.post_id));
          mapped = mapped.map(p => ({ ...p, liked: likedSet.has(p.id) }));
        }
      }

      if (reset) {
        setState({ posts: mapped });
      } else {
        const prevPosts = stateRef.current.posts;
        const seen = new Set(prevPosts.map(p => p.id));
        const combined = [...prevPosts, ...mapped.filter(p => !seen.has(p.id))];
        setState({ posts: combined });
      }
      return { hasMore: rawPosts ? rawPosts.length >= 12 : false };
      } catch (err: any) {
        if ((isRecoverableAbort(err) || isTimeoutError(err)) && attempt + 1 < MAX_FETCH_POSTS_ATTEMPTS) {
          console.warn(`fetch_posts retrying (attempt ${attempt + 1}) after abort`);
          await sleep(600);
          return fetchPosts({ reset, attempt: attempt + 1 });
        }
        logError('fetch_posts', err);
        setError(formatErrorMessage(err, `Error loading feed: ${err?.message || 'Unknown error'}`));
        return { hasMore: false };
      }
  }, []);

  const fetchProfiles = useCallback(async () => {
    if (!hasSupabase) return;
    try {
        const { data, error: profileError } = await withTimeout(
          supabase
            .from('profiles')
            .select(PROFILE_SELECT)
            .limit(40)
        );
      if (profileError) throw profileError;
      setState({ profiles: data ?? [] });
    } catch (err: any) {
      logError('fetch_profiles', err);
    }
  }, []);

  const fetchConversations = useCallback(async (userId?: string | null) => {
    if (!hasSupabase) return;
    const targetUserId = userId ?? stateRef.current.currentUser?.id;
    if (!targetUserId) { setState({ conversations: [] }); return; }

    try {
      // Step 1: Get conversation IDs for this user
      const { data: myParticipants, error: p1 } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', targetUserId);
      if (p1) throw p1;

      const conversationIds = [...new Set(
        (myParticipants ?? []).map((r: any) => r.conversation_id).filter(Boolean)
      )];
      if (!conversationIds.length) { setState({ conversations: [] }); return; }

      // Step 2: Get conversations
      const { data: convRows, error: p2 } = await supabase
        .from('conversations')
        .select('id, title, last_message, last_message_at, created_at')
        .in('id', conversationIds)
        .order('last_message_at', { ascending: false });
      if (p2) throw p2;

      // Step 3: Get all participants manually to bypass Supabase FK errors
      const { data: allParticipants, error: p3 } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id')
        .in('conversation_id', conversationIds);
      if (p3) throw p3;

      const profileIds = [...new Set((allParticipants ?? []).map((p: any) => p.user_id).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      if (profileIds.length > 0) {
        const { data: profilesData } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', profileIds);
        (profilesData ?? []).forEach((p: any) => { profilesMap[p.id] = p; });
      }

      const conversations: ConversationSummary[] = (convRows ?? []).map((row: any) => {
        const rowParticipants = (allParticipants ?? []).filter(
          (p: any) => p.conversation_id === row.id
        );
        const other = rowParticipants.find((p: any) => p.user_id !== targetUserId);
        const otherProfile = other ? profilesMap[other.user_id] : null;
        return {
          id: row.id,
          title: row.title || otherProfile?.full_name || 'Conversation',
          last_message: row.last_message,
          last_message_at: row.last_message_at ?? row.created_at,
          created_at: row.created_at,
          participant: otherProfile
            ? { id: otherProfile.id, name: otherProfile.full_name, avatar_url: otherProfile.avatar_url }
            : undefined,
        };
      });

      setState({ conversations });
    } catch (err: any) {
      logError('fetch_conversations', err);
    }
  }, []);
  
  const fetchCredits = useCallback(async (userId?: string | null) => {
    if (!hasSupabase) return;
    const targetUserId = userId ?? stateRef.current.currentUser?.id;
    if (!targetUserId) {
      setState({ creditsWallet: null, creditsLedger: [] });
      return;
    }
    try {
      const [walletRes, ledgerRes] = await Promise.all([
        supabase
          .from('credits_wallets')
          .select('user_id, balance, updated_at')
          .eq('user_id', targetUserId)
          .maybeSingle(),
        supabase
          .from('credits_ledger')
          .select('id, user_id, amount, direction, reason, ref_type, ref_id, created_at')
          .eq('user_id', targetUserId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (walletRes.error) throw walletRes.error;
      if (ledgerRes.error) throw ledgerRes.error;
      setState({
        creditsWallet: (walletRes.data as CreditsWallet | null) ?? { user_id: targetUserId, balance: 0 },
        creditsLedger: (ledgerRes.data as CreditsLedgerEntry[]) ?? [],
      });
    } catch (err) {
      logError('fetch_credits', err);
    }
  }, []);

  const fetchNotifications = useCallback(async (userId?: string | null) => {
    if (!hasSupabase) return;
    const targetUserId = userId ?? stateRef.current.currentUser?.id;
    if (!targetUserId) {
      setState({ notifications: [] });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('notification_events')
        .select('id, user_id, event_type, title, body, status, created_at')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setState({ notifications: (data ?? []) as NotificationEvent[] });
    } catch (err) {
      logError('fetch_notifications', err);
    }
  }, []);

  const adjustCredits = useCallback(async (amount: number, reason?: string, refType?: string, refId?: string) => {
    if (!hasSupabase) return 0;
    try {
      const { data, error } = await supabase.rpc('credits_adjust', {
        p_amount: amount,
        p_reason: reason ?? null,
        p_ref_type: refType ?? null,
        p_ref_id: refId ?? null,
      });
      if (error) throw error;
      const balance = Array.isArray(data) ? data[0]?.balance : data?.balance;
      if (typeof balance === 'number') {
        const currentWallet = stateRef.current.creditsWallet;
        setState({
          creditsWallet: currentWallet ? { ...currentWallet, balance } : currentWallet,
        });
      }
      await fetchCredits(stateRef.current.currentUser?.id ?? null);
      return typeof balance === 'number' ? balance : 0;
    } catch (err) {
      logError('adjust_credits', err);
      throw err;
    }
  }, [fetchCredits]);

  const redeemCreditsCode = useCallback(async (code: string) => {
    if (!hasSupabase) return 0;
    try {
      const { data, error } = await supabase.rpc('credits_redeem_code', { p_code: code });
      if (error) throw error;
      const balance = Array.isArray(data) ? data[0]?.balance : data?.balance;
      if (typeof balance === 'number') {
        const currentWallet = stateRef.current.creditsWallet;
        setState({
          creditsWallet: currentWallet ? { ...currentWallet, balance } : currentWallet,
        });
      }
      await fetchCredits(stateRef.current.currentUser?.id ?? null);
      return typeof balance === 'number' ? balance : 0;
    } catch (err) {
      logError('redeem_credits_code', err);
      throw err;
    }
  }, [fetchCredits]);

  const fetchEarnings = useCallback(async (userId: string) => {
    if (!hasSupabase) return;
    try {
      const data = await fetchCreatorEarnings(userId);
      setState({ earnings: data });
    } catch (err) {
      logError('fetch_earnings', err);
    }
  }, []);

  const fetchSubscriptions = useCallback(async (userId?: string | null) => {
    if (!hasSupabase) return;
    const targetUserId = userId ?? stateRef.current.currentUser?.id;
    if (!targetUserId) { setState({ subscriptions: [] }); return; }
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('id, subscriber_id, creator_id, tier_id, status, current_period_start, current_period_end, created_at')
        .or(`subscriber_id.eq.${targetUserId},creator_id.eq.${targetUserId}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setState({ subscriptions: data ?? [] });
    } catch (err) {
      logError('fetch_subscriptions', err);
    }
  }, []);

  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed: AppState = JSON.parse(stored);
          setState({ ...initialState, ...parsed, currentUser: parsed.currentUser ? { ...parsed.currentUser, verified: Boolean((parsed.currentUser as any).verified) }: null });
        }

        if (hasSupabase) {
          try {
            const { data } = await supabase.auth.getUser();
            if (data.user) {
              const profile = await fetchProfile(data.user.id);
              setState({ currentUser: mapSupabaseUser(data.user, profile?.role || 'client', profile) });
              await Promise.all([
                fetchBookings(data.user.id),
                fetchConversations(data.user.id),
                fetchEarnings(data.user.id),
                fetchSubscriptions(data.user.id),
                fetchCredits(data.user.id)
              ]);
            } else {
              setState({ bookings: [], conversations: [] });
            }
          } catch (authErr) {
            console.warn('Network offline or auth failed, skipping live session check and using cache.');
          }
          await Promise.all([fetchPhotographers(), fetchModels()]);
        }
      } catch (err) {
        logError('load_state', err);
        // Do not ruin the user experience by throwing a hard UI error overlay for local cache misses
        console.warn('Unable to load saved data, initializing fresh.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [fetchBookings, fetchConversations, fetchCredits, fetchPhotographers, fetchProfile, fetchModels, fetchSubscriptions]);

  useEffect(() => {
    if (!hasSupabase) return;
    const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (__DEV__) console.log('Auth State Change Event:', event);
      if (session?.user) {
        try {
          let profile = await fetchProfile(session.user.id);
          
          // Handle OAuth sign-ups where profile doesn't exist yet
          if (!profile) {
            if (__DEV__) console.log('No profile found, profile creation will be handled by RoleSelectionScreen for:', session.user.id);
            // We set role to null to trigger RoleSelectionScreen in MainNavigator
            profile = { role: null, verified: false };
          }

          const currentRole = profile?.role ?? null;
          setState({ currentUser: mapSupabaseUser(session.user, currentRole as any, profile)});

          // Register for push notifications (Async, don't block auth flow)
          registerForPushNotificationsAsync()
            .then(token => { if (token) savePushTokenAsync(session.user!.id, token); })
            .catch(e => console.warn('Push registration failed', e));

          // Fetch lists
          fetchBookings(session.user.id).catch(e => console.warn('Delayed booking fetch failed', e));
          fetchConversations(session.user.id).catch(e => console.warn('Delayed convo fetch failed', e));
          fetchEarnings(session.user.id).catch(e => console.warn('Delayed earnings fetch failed', e));
          fetchSubscriptions(session.user.id).catch(e => console.warn('Delayed subscriptions fetch failed', e));
          fetchCredits(session.user.id).catch(e => console.warn('Delayed credits fetch failed', e));
          fetchNotifications(session.user.id).catch(e => console.warn('Delayed notifications fetch failed', e));
        } catch (eventErr) {
          console.error('Error handling auth session change:', eventErr);
        }
      } else {
        setState({ currentUser: null,  subscriptions: [],
  tips: [],
  earnings: [],
  mediaAssets: [],
  creditsWallet: null,
  creditsLedger: [],
  notifications: [], messages: {} });
      }
    });

    const postsChannel = supabase
      .channel('global:posts-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, async (payload) => {
        if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as any)?.id;
          if (deletedId) {
            setState({ posts: stateRef.current.posts.filter(p => p.id !== deletedId) });
          }
          return;
        }
        
        // For INSERT/UPDATE, we re-fetch the specific post to get profile joins
        const targetId = (payload.new as any)?.id;
        if (!targetId) return;

        const { data: rawPost } = await supabase
          .from('posts')
          .select(`
            id, author_id, caption, location, comment_count, created_at, image_url, likes_count
          `)
          .eq('id', targetId)
          .maybeSingle();

        if (rawPost) {
          rawPost.image_url = await resolveStorageRef(rawPost.image_url ?? '', BUCKETS.posts);
          const { data: profileData } = await supabase.from('profiles').select('id, full_name, city, avatar_url').eq('id', rawPost.author_id).maybeSingle();
          const postData = { ...rawPost, profiles: profileData ? [profileData] : [] };
          const hydrated = mapPostRow(postData);
          
          // Check if liked by current user
          const currentUserId = stateRef.current.currentUser?.id;
          if (currentUserId) {
            const { data: likeData } = await supabase
              .from('post_likes')
              .select('id')
              .eq('user_id', currentUserId)
              .eq('post_id', hydrated.id)
              .maybeSingle();
            hydrated.liked = !!likeData;
          }

          setState({
            posts: stateRef.current.posts.some(p => p.id === hydrated.id)
              ? stateRef.current.posts.map(p => p.id === hydrated.id ? hydrated : p)
              : [hydrated, ...stateRef.current.posts].slice(0, 100)
          });
        }
      })
      .subscribe();

    // Unified Profile Sync
    const profileChannel = supabase
      .channel('global:profiles-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, async (payload) => {
        const updatedProfile = payload.new as any;
        const currentUserId = stateRef.current.currentUser?.id;

          if (updatedProfile.id === currentUserId) {
            setState({ currentUser: mapSupabaseUser(stateRef.current.currentUser, updatedProfile.role, updatedProfile) });
          }

          setState({
            profiles: stateRef.current.profiles.map((p) =>
              p.id === updatedProfile.id ? { ...p, ...updatedProfile } : p
            ),
            posts: stateRef.current.posts.map((post) =>
              post.author_id === updatedProfile.id
                ? { ...post, profile: { ...(post.profile ?? {}), avatar_url: updatedProfile.avatar_url, full_name: updatedProfile.full_name ?? post.profile?.full_name } }
                : post
            ),
            bookings: stateRef.current.bookings.map((booking) => {
              const isClient = booking.client?.id === updatedProfile.id;
              const isPhotographer = booking.photographer?.id === updatedProfile.id;
              if (!isClient && !isPhotographer) return booking;
              return {
                ...booking,
                client: isClient ? { ...booking.client, avatar_url: updatedProfile.avatar_url, name: updatedProfile.full_name ?? booking.client?.name } : booking.client,
                photographer: isPhotographer ? { ...booking.photographer, avatar_url: updatedProfile.avatar_url, name: updatedProfile.full_name ?? booking.photographer?.name } : booking.photographer,
              };
            }),
          });

        // Update list views if the profile belongs to a photographer or model
        if (stateRef.current.photographers.some(p => p.id === updatedProfile.id)) {
            fetchPhotographers();
        }
        if (stateRef.current.models.some(m => m.id === updatedProfile.id)) {
            fetchModels();
        }
      })
      .subscribe();

    // Booking Sync
    const bookingChannel = supabase
      .channel('global:bookings-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, async (payload) => {
        const currentUserId = stateRef.current.currentUser?.id;
        if (!currentUserId) return;

        const booking = (payload.new || payload.old) as any;
        if (booking.client_id === currentUserId || booking.photographer_id === currentUserId) {
            fetchBookings(currentUserId);
        }
      })
      .subscribe();

    // Notification Sync
    const notificationChannel = supabase
      .channel('global:notifications-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_events' }, async (payload) => {
        const currentUserId = stateRef.current.currentUser?.id;
        if (!currentUserId) return;
        const notification = (payload.new || payload.old) as any;
        if (notification.user_id === currentUserId) {
          fetchNotifications(currentUserId);
        }
      })
      .subscribe();

    const earningsChannel = supabase
      .channel('global:earnings-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'earnings' }, async (payload) => {
        const currentUserId = stateRef.current.currentUser?.id;
        if (!currentUserId) return;
        const earning = (payload.new || payload.old) as any;
        if (earning?.user_id === currentUserId) {
          fetchEarnings(currentUserId);
        }
      })
      .subscribe();

    const subscriptionsChannel = supabase
      .channel('global:subscriptions-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, async (payload) => {
        const currentUserId = stateRef.current.currentUser?.id;
        if (!currentUserId) return;
        const subscription = (payload.new || payload.old) as any;
        if (subscription?.creator_id === currentUserId || subscription?.subscriber_id === currentUserId) {
          fetchSubscriptions(currentUserId);
        }
      })
      .subscribe();

    // Messages Realtime — live chat updates
    const messagesChannel = supabase
      .channel('global:messages-sync')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const newRow = payload.new as any;
          const currentUserId = stateRef.current.currentUser?.id;
          const chatId = newRow.chat_id || newRow.conversation_id;
          if (!chatId) return;

          // Only process if current user participates in this conversation
          const isParticipant = stateRef.current.conversations.some(c => c.id === chatId);
          if (!isParticipant) {
             fetchConversations(currentUserId).catch(e => console.warn('Delayed new conversation fetch failed', e));
             return;
          }

          const newMessage: Message = {
            id: newRow.id,
            conversation_id: chatId,
            from_user: newRow.sender_id === currentUserId,
            body: newRow.body ?? newRow.text ?? '',
            timestamp: newRow.created_at ?? new Date().toISOString(),
            message_type: newRow.message_type ?? 'text',
            media_url: newRow.media_url ? await resolveStorageRef(newRow.media_url, BUCKETS.previews) : null,
            preview_url: newRow.preview_url ? await resolveStorageRef(newRow.preview_url, BUCKETS.previews) : null,
            locked: newRow.locked ?? false,
            unlocked: newRow.unlocked ?? true,
            unlock_booking_id: newRow.unlock_booking_id ?? null,
          };

          const existing = stateRef.current.messages[chatId] ?? [];
          // Avoid duplicates from optimistic update
          if (existing.some(m => m.id === newMessage.id)) return;
          setState({
            messages: {
              ...stateRef.current.messages,
              [chatId]: [...existing, newMessage],
            },
          });
        }
      )
      .subscribe();

    return () => {
      data.subscription?.unsubscribe();
      supabase.removeChannel(postsChannel);
      supabase.removeChannel(profileChannel);
      supabase.removeChannel(bookingChannel);
      supabase.removeChannel(notificationChannel);
      supabase.removeChannel(earningsChannel);
      supabase.removeChannel(subscriptionsChannel);
      supabase.removeChannel(messagesChannel);
    };
  }, [fetchBookings, fetchConversations, fetchEarnings, fetchNotifications, fetchProfile, fetchSubscriptions]);

  useEffect(() => {
    const persist = async () => {
      try {
        const persistedState: AppState = {
          ...state,
          loading: false,
          saving: false,
          authenticating: false,
          error: null,
        };
        const serialized = JSON.stringify(persistedState);
        await AsyncStorage.setItem(STORAGE_KEY, serialized);
      } catch (err) {
        logError('persist_state', err);
        setError('Unable to save data locally.');
      }
    };

    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    persistDebounceRef.current = setTimeout(persist, 400);
  }, [state]);

    const createBooking = useCallback(
    async (payload: CreateBookingInput) => {
      const currentUser = stateRef.current.currentUser;
      if (!currentUser) {
        throw new Error('You must be logged in to create a booking.');
      }

      // Assertions for financial integrity
      if (!payload.base_amount || payload.base_amount < 0) {
        throw new Error('Invalid base amount: must be non-negative');
      }
      if ((payload.travel_amount ?? 0) < 0) {
        throw new Error('Invalid travel amount: must be non-negative');
      }

      // Papzi dynamic pricing: base fee + Uber-style travel surcharge
      const base = payload.base_amount ?? 1200;
      const travel = payload.travel_amount ?? 0;
      const total = base + travel;
      const commission = Math.round(total * 0.30);
      const payout = total - commission;

      const booking: Booking = {
        id: uid('booking'),
        photographer_id: payload.talent_id || payload.photographer_id || '',
        model_id: payload.talent_type === 'model' ? (payload.talent_id || payload.model_id || null) : null,
        client_id: currentUser.id,
        booking_date: payload.booking_date,
        package_type: payload.package_type,
        notes: payload.notes,
        status: 'pending',
        created_at: new Date().toISOString(),
        total_amount: total,
        commission_amount: commission,
        payout_amount: payout,
        fanout_count: payload.fanout_count ?? 1,
        intensity_level: payload.intensity_level ?? 1,
        quote_token: payload.quote_token ?? null,
        assignment_state: payload.assignment_state ?? 'queued',
        dispatch_request_id: payload.dispatch_request_id ?? null,
      };

      let persistedBooking = booking;

      if (hasSupabase) {
        try {
          const providerId = payload.talent_id || payload.photographer_id || payload.model_id;
          const isModel = payload.talent_type === 'model';
          
          const data = await createBookingRequest({
            talentId: providerId || '',
            clientId: currentUser.id,
            talentType: isModel ? 'model' : 'photographer',
            packageId: payload.package_type,
            totalAmount: total,
            latitude: payload.latitude || 0,
            longitude: payload.longitude || 0,
            startTime: payload.start_datetime || payload.booking_date.split('|')[0] || new Date().toISOString(),
            endTime: payload.end_datetime || payload.booking_date.split('|')[1] || new Date().toISOString(),
            fanoutCount: payload.fanout_count ?? 1,
            intensityLevel: payload.intensity_level ?? 1,
            quoteToken: payload.quote_token ?? undefined,
            assignmentState: payload.assignment_state ?? 'queued',
            dispatchRequestId: payload.dispatch_request_id ?? undefined,
          });

          persistedBooking = {
            id: data.id,
            photographer_id: data.photographer_id,
            model_id: data.model_id,
            client_id: data.client_id,
            booking_date: data.booking_date ?? payload.booking_date,
            package_type: data.package_type ?? payload.package_type,
            notes: data.notes ?? payload.notes ?? '',
            status: data.status,
            created_at: data.created_at ?? new Date().toISOString(),
            start_datetime: data.start_datetime ?? payload.start_datetime,
            end_datetime: data.end_datetime ?? payload.end_datetime,
            user_latitude: data.user_latitude ?? payload.latitude ?? null,
            user_longitude: data.user_longitude ?? payload.longitude ?? null,
            total_amount: Number(data.total_amount ?? data.price_total ?? total),
            commission_amount: Number(data.commission_amount ?? commission),
            payout_amount: Number(data.payout_amount ?? data.photographer_payout ?? payout),
            fanout_count: data.fanout_count ?? payload.fanout_count ?? 1,
            intensity_level: data.intensity_level ?? payload.intensity_level ?? 1,
            quote_token: data.quote_token ?? payload.quote_token ?? null,
            assignment_state: data.assignment_state ?? payload.assignment_state ?? 'queued',
            eta_confidence: data.eta_confidence ?? null,
            dispatch_request_id: data.dispatch_request_id ?? payload.dispatch_request_id ?? null,
          };
        } catch (error: any) {
          logError('createBooking', error);
          const rawMessage = String(error?.message || '');
          const isOverlapError =
            /overlap/i.test(rawMessage) ||
            /already has an overlapping booking/i.test(rawMessage) ||
            /prevent_booking_overlap/i.test(rawMessage);
          const friendlyMessage = isOverlapError
            ? 'This provider is already booked in that time slot. Please choose a different time.'
            : formatErrorMessage(error, 'Unable to create booking.');
          setError(friendlyMessage);
          throw new Error(friendlyMessage);
        }
      }

      setState({ bookings: [persistedBooking, ...stateRef.current.bookings] });
      return persistedBooking;
    },
    []
  );

    const updateBookingStatus = useCallback(async (bookingId: string, targetStatus?: BookingStatus) => {
    const nextStatus = (current: BookingStatus): BookingStatus => {
      if (targetStatus) return targetStatus;
      const order: BookingStatus[] = ['pending', 'accepted', 'completed'];
      const index = order.indexOf(current);
      if (index < 0) return current;
      return order[Math.min(index + 1, order.length - 1)];
    };

    const originalBookings = stateRef.current.bookings;
    const booking = originalBookings.find(b => b.id === bookingId);
    if (!booking) {
        logError('updateBookingStatus', new Error('Booking not found'));
        return;
    }

    const newStatus = nextStatus(booking.status);
    let updatedBooking: Booking | undefined;

    // Optimistic update
    const bookings: Booking[] = originalBookings.map((b) => {
        if (b.id !== bookingId) return b;
        updatedBooking = { ...b, status: newStatus };
        return updatedBooking;
    });
    setState({ bookings });


    if (hasSupabase) {
        try {
            const { error } = await supabase
                .from('bookings')
                .update({ status: newStatus })
                .eq('id', bookingId);
            
            if (error) {
                // Revert optimistic update
                setState({ bookings: originalBookings });
                logError('updateBookingStatus', error);
                setError(formatErrorMessage(error, 'Unable to update booking status.'));
                throw error;
            }

            if (['accepted', 'completed'].includes(newStatus)) {
              const actorId = stateRef.current.currentUser?.id;
              const providerId = booking.model_id ?? booking.photographer_id;
              const targetUserId = actorId === booking.client_id ? providerId : booking.client_id;
              if (actorId && targetUserId && targetUserId !== actorId) {
                const { error: mailError } = await supabase.functions.invoke('send-app-email', {
                  body: {
                    action: 'booking_status',
                    booking_id: bookingId,
                    status: newStatus,
                    user_id: targetUserId,
                    booking_date: booking.booking_date ?? null,
                  },
                });
                if (mailError) {
                  console.warn('booking status email failed:', mailError.message);
                }
              }
            }
        } catch(err) {
             // Revert optimistic update
             setState({ bookings: originalBookings });
             logError('updateBookingStatus', err);
             setError(formatErrorMessage(err, 'Unable to update booking status.'));
             throw err;
        }
    }

    return updatedBooking;
  }, []);

  const sendMessage = useCallback(
    async (chatId: string, text: string, fromUser: boolean = true): Promise<Message> => {
      const senderId = stateRef.current.currentUser?.id;
      if (!senderId) {
        const message = 'You need to be signed in to send messages.';
        setError(message);
        throw new Error(message);
      }

      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error('Message text is required.');
      }

      const optimisticMessage: Message = {
        id: uid('msg'),
        conversation_id: chatId,
        from_user: fromUser,
        body: trimmed,
        timestamp: new Date().toISOString(),
        message_type: 'text',
      };

      const prevMsgs = stateRef.current.messages[chatId] ?? [];
      setState({ messages: { ...stateRef.current.messages, [chatId]: [...prevMsgs, optimisticMessage] } });

      if (!hasSupabase) {
        return optimisticMessage;
      }

      try {
        const sent = await sendConversationTextMessage({ conversationId: chatId, text: trimmed });
        const confirmed: Message = {
          id: sent.id,
          conversation_id: sent.conversation_id || chatId,
          from_user: sent.sender_id === senderId,
          body: sent.body,
          timestamp: sent.timestamp ?? new Date().toISOString(),
          message_type: sent.message_type,
          media_url: sent.media_url ?? null,
          preview_url: sent.preview_url ?? null,
          locked: sent.locked ?? false,
          unlocked: sent.unlocked ?? true,
          unlock_booking_id: sent.unlock_booking_id ?? null,
        };
        const latestForChat = stateRef.current.messages[chatId] ?? [];
        setState({
          messages: {
            ...stateRef.current.messages,
            [chatId]: latestForChat.map(m => m.id === optimisticMessage.id ? confirmed : m),
          },
        });
        return confirmed;
      } catch (err: any) {
        const revertMsgs = stateRef.current.messages[chatId] ?? [];
        setState({ messages: { ...stateRef.current.messages, [chatId]: revertMsgs.filter(m => m.id !== optimisticMessage.id) } });
        logError('send_message', err);
        const friendly = formatErrorMessage(err, 'Unable to send your message right now.');
        setError(friendly);
        throw new Error(friendly);
      }
    },
    []
  );

  const sendLockedMediaMessage = useCallback(
    async (
      chatId: string,
      payload: { mediaUrl: string; previewUrl?: string; text?: string; unlockBookingId?: string; unlockPrice?: number; }
    ) => {
      const senderId = stateRef.current.currentUser?.id;
      if (!senderId) {
        const message = 'You need to be signed in to send media.';
        setError(message);
        throw new Error(message);
      }
      if (!hasSupabase) {
        throw new Error('Media messages require a backend connection.');
      }

      const optimisticMessage: Message = {
        id: uid('msg'),
        conversation_id: chatId,
        from_user: true,
        body: payload.text || 'Shared a locked photo',
        timestamp: new Date().toISOString(),
        message_type: 'media',
        media_url: payload.mediaUrl,
        preview_url: payload.previewUrl || payload.mediaUrl,
        locked: true,
        unlocked: false,
        unlock_booking_id: payload.unlockBookingId,
        unlock_price: payload.unlockPrice,
      };

      const prevLockedMsgs = stateRef.current.messages[chatId] ?? [];
      setState({ messages: { ...stateRef.current.messages, [chatId]: [...prevLockedMsgs, optimisticMessage] } });

      if (!hasSupabase) {
        return optimisticMessage;
      }

      try {
        let finalMediaUrl = payload.mediaUrl;
        let finalPreviewUrl = payload.previewUrl;

        // Perform cloud uploads if it's a local URI
        if (payload.mediaUrl.startsWith('file://') || payload.mediaUrl.startsWith('content://')) {
          setSaving(true);
          try {
            // Chat media goes to 'chat-media' bucket per backend spec (private, signed URLs)
            finalMediaUrl = await uploadImage(payload.mediaUrl, BUCKETS.previews, { returnStorageRef: true });
            const previewRes = await uploadBlurredPreview(payload.mediaUrl);
            finalPreviewUrl = previewRes.success ? previewRes.data : payload.mediaUrl;
          } finally {
            setSaving(false);
          }
        }

        const res = await sendConversationLockedMediaMessage({
          conversationId: chatId,
          mediaUrl: finalMediaUrl,
          previewUrl: finalPreviewUrl || finalMediaUrl,
          text: payload.text,
          unlockBookingId: payload.unlockBookingId,
          unlockPrice: payload.unlockPrice,
        });

        const confirmed: Message = {
          id: res.id,
          conversation_id: res.conversation_id || chatId,
          from_user: res.sender_id === senderId,
          body: res.body,
          timestamp: res.timestamp ?? new Date().toISOString(),
          message_type: 'media',
          media_url: res.media_url ? await resolveStorageRef(res.media_url, BUCKETS.previews) : res.media_url,
          preview_url: res.preview_url ? await resolveStorageRef(res.preview_url, BUCKETS.previews) : res.preview_url,
          locked: res.locked,
          unlocked: res.unlocked,
          unlock_booking_id: res.unlock_booking_id,
          unlock_price: res.unlock_price,
        };
        const latestLockedMsgs = stateRef.current.messages[chatId] ?? [];
        setState({
          messages: {
            ...stateRef.current.messages,
            [chatId]: latestLockedMsgs.map(m => m.id === optimisticMessage.id ? confirmed : m),
          },
        });
        return confirmed;
      } catch (err: any) {
        const revertLockedMsgs = stateRef.current.messages[chatId] ?? [];
        setState({ messages: { ...stateRef.current.messages, [chatId]: revertLockedMsgs.filter(m => m.id !== optimisticMessage.id) } });
        logError('send_locked_media', err);
        const friendly = formatErrorMessage(err, 'Unable to send media right now.');
        setError(friendly);
        throw new Error(friendly);
      }
    },
    []
  );

  const fetchMessages = useCallback(async (chatId: string) => {
    if (!hasSupabase) return;
    const currentUserId = stateRef.current.currentUser?.id;
    if (!currentUserId) return;

    try {
      // Guard against local optimistic IDs like "conv-xxx" that aren't real UUIDs
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(chatId)) {
        console.warn('Skipping fetchMessages for non-UUID chatId:', chatId);
        return;
      }
      const data = await listConversationMessages(chatId);
      const parsedMessages: Message[] = await Promise.all(
        (data || []).map(async (row: any) => ({
          id: row.id,
          conversation_id: chatId,
          from_user: row.sender_id === currentUserId,
          body: row.body ?? row.text,
          timestamp: row.created_at || new Date().toISOString(),
          message_type: row.message_type ?? 'text',
          media_url: row.media_url ? await resolveStorageRef(row.media_url, BUCKETS.previews) : null,
          preview_url: row.preview_url ? await resolveStorageRef(row.preview_url, BUCKETS.previews) : null,
          locked: row.locked ?? false,
          unlocked: row.unlocked ?? true,
          unlock_booking_id: row.unlock_booking_id ?? null,
        }))
      );

      const prevForChat = stateRef.current.messages[chatId] ?? [];
      const combined = dedupeById([...prevForChat, ...parsedMessages]);
      setState({ messages: { ...stateRef.current.messages, [chatId]: combined } });
    } catch (err) {
      logError('fetch_messages', err);
      setError('Unable to load messages for this chat.');
    }
  }, []);

  const fetchMessagesForChat = useCallback(async (chatId: string) => {
    // backwards compatible alias
    return fetchMessages(chatId);
  }, [fetchMessages]);

  const startConversationWithUser = useCallback(async (participantId: string, title?: string) => {
    const currentState = stateRef.current;
    const currentUserId = currentState.currentUser?.id;
    if (!currentUserId) {
      const msg = 'You need to be signed in to message users.';
      setError(msg);
      throw new Error(msg);
    }
    if (participantId === currentUserId) {
      const msg = 'You cannot start a chat with yourself.';
      setError(msg);
      throw new Error(msg);
    }

    // Check if a conversation with this user already exists
    const existingConversation = currentState.conversations.find((c) => c.participant?.id === participantId);
    if (existingConversation) {
        return { id: existingConversation.id, title: existingConversation.title };
    }

    const convoTitle = title ?? `Chat with ${participantId}`;

    const convo: ConversationSummary = {
        id: uid('conv'),
        title: convoTitle,
        participants: [currentUserId, participantId],
        last_message: 'Say hello 👋',
        last_message_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
    };

    // Optimistic update
    const originalConversations = currentState.conversations;
    setState({ conversations: [convo, ...originalConversations] });


    if (hasSupabase) {
      try {
        const data = await startConversationViaEdge({ participantId, title: convoTitle });
        const newConvo: ConversationSummary = {
          ...convo,
          id: data.id,
          title: data.title,
        };
        const updatedConversations = stateRef.current.conversations.map((c) => c.id === convo.id ? newConvo : c);
        setState({ conversations: updatedConversations });
        return { id: newConvo.id, title: newConvo.title };
      } catch (err: any) {
        logError('start_conversation_edge_failed', err);
        
        // Fallback: Direct Database Insertion (Client-Side RLS Fallback)
        try {
          // 1. Create Conversation
          // Note: RLS policy "conversations_insert_auth" allows this for authenticated users
          const { data: convData, error: convErr } = await supabase
            .from('conversations')
            .insert({
              title: convoTitle,
              created_by: currentUserId,
              last_message: 'Say hello 👋',
              last_message_at: new Date().toISOString()
            })
            .select('id, title')
            .single();

          if (convErr) {
            // If we get an RLS error here, it's likely the migration wasn't applied or user is not logged in
            console.error('RLS Error creating conversation:', convErr);
            throw convErr;
          }
          if (!convData) throw new Error('No conversation data returned');

          // 2. Add Self as Participant (Allowed by RLS)
          const { error: partSelfErr } = await supabase
            .from('conversation_participants')
            .insert({
              conversation_id: convData.id,
              user_id: currentUserId
            });
          // 23505 = duplicate key (Trigger already added us)
          if (partSelfErr && partSelfErr.code !== '23505') {
            console.error('RLS Error adding self as participant:', partSelfErr);
            throw partSelfErr;
          }

          // 3. Add Other Participant
          const { error: partOtherErr } = await supabase
            .from('conversation_participants')
            .insert({
              conversation_id: convData.id,
              user_id: participantId,
            });
          
          if (partOtherErr && partOtherErr.code !== '23505') {
             console.warn('Fallback participant add failed for other user:', partOtherErr);
          }

          const confirmedConvo: ConversationSummary = {
            ...convo,
            id: convData.id,
            title: convData.title || convoTitle,
          };

          const updatedConversations = stateRef.current.conversations.map((c) => c.id === convo.id ? confirmedConvo : c);
          setState({ conversations: updatedConversations });
          return { id: confirmedConvo.id, title: confirmedConvo.title };

        } catch (fallbackErr: any) {
          // Revert optimistic update only if even the fallback fails
          setState({ conversations: originalConversations });
          logError('start_conversation_fallback_failed', fallbackErr);
          const friendly = formatErrorMessage(fallbackErr, 'Unable to start a chat right now. Please ensure your migration is applied.');
          setError(friendly);
          throw new Error(friendly);
        }
      }
    }

    return { id: convo.id, title: convo.title };
  }, []);

  const addPost = useCallback(
    async ({ caption, imageUri, location, userId }: CreatePostInput) => {
      const ownerId = userId ?? stateRef.current.currentUser?.id;
      if (!ownerId) {
        const message = 'You need an account to publish a post.';
        setError(message);
        throw new Error(message);
      }

        const post: Post = {
            id: uid('post'),
            author_id: ownerId,
            caption,
            image_url: imageUri,
            created_at: new Date().toISOString(),
            likes_count: 0,
            liked: false,
            comment_count: 0,
            location,
        };

        // Optimistic update
        const originalPosts = stateRef.current.posts;
        setState({ posts: [post, ...originalPosts] });

        if (hasSupabase) {
            try {
                let finalImageRef = imageUri;
                let finalImageUrl = imageUri;
                if (imageUri.startsWith('file://') || imageUri.startsWith('content://')) {
                  finalImageRef = await uploadImage(imageUri, BUCKETS.posts, { returnStorageRef: true });
                  finalImageUrl = await resolveStorageRef(finalImageRef, BUCKETS.posts);
                }

                const { data, error: insertError } = await supabase
                .from('posts')
                .insert({
                    author_id: ownerId,
                    caption,
                    location,
                    image_url: finalImageRef,
                })
                .select('id, author_id, caption, location, comment_count, created_at, image_url, likes_count')
                .single();

                if (insertError) {
                    throw insertError;
                }

                const newPost = {
                    ...post,
                    id: data?.id ?? post.id,
                    likes_count: data?.likes_count ?? 0,
                    comment_count: data?.comment_count ?? 0,
                    created_at: data?.created_at ?? new Date().toISOString(),
                    image_url: finalImageUrl,
                };

                // Replace optimistic post with the real one
                const latestPosts = stateRef.current.posts;
                setState({ posts: latestPosts.map(p => p.id === post.id ? newPost : p) });
                return newPost;

            } catch (err: any) {
                // Revert optimistic update
                setState({ posts: originalPosts });
                logError('add_post', err);
                const message = formatErrorMessage(err, 'Unable to publish your post right now.');
                setError(message);
                throw err;
            }
        }

      return post;
    },
    []
  );

  const toggleLike = useCallback(async (postId: string) => {
    const userId = stateRef.current.currentUser?.id;
    if (!userId) {
      const msg = 'You need to be signed in to like posts.';
      setError(msg);
      throw new Error(msg);
    }

    // Optimistic update locally
    const originalPosts = stateRef.current.posts;
    let optimistic: Post | undefined;
    const posts = originalPosts.map((post) => {
        if (post.id !== postId) return post;
        const liked = !post.liked;
        optimistic = { ...post, liked, likes_count: liked ? post.likes_count + 1 : Math.max(0, post.likes_count - 1) };
        return optimistic;
    });
    setState({ posts });

    if (hasSupabase) {
      try {
        const { data, error } = await supabase.rpc('toggle_post_like', {
          p_post_id: postId,
          p_user_id: userId,
        });

        if (error) throw error;

        // RPC returns boolean: true = now liked, false = now unliked
        const nowLiked = data as unknown as boolean;
        setState({
          posts: stateRef.current.posts.map((p) => {
            if (p.id !== postId) return p;
            return {
              ...p,
              liked: nowLiked,
              likes_count: nowLiked
                ? p.likes_count + 1
                : Math.max(0, p.likes_count - 1),
            };
          }),
        });
      } catch (err: any) {
        // Roll back optimistic toggled like
        setState({ posts: originalPosts });
        const message = formatErrorMessage(err, 'Unable to update like right now.');
        setError(message);
        logError('toggle_like', err);
        throw err;
      }
    }

    return optimistic;
  }, []);

  const addComment = useCallback(async (postId: string, text: string, userId?: string) => {
    const currentState = stateRef.current;
    const resolvedUserId = userId ?? currentState.currentUser?.id;
    if (!resolvedUserId) {
      const message = 'You need to be signed in to comment.';
      setError(message);
      throw new Error(message);
    }

    const comment: Comment = {
      id: uid('comment'),
      post_id: postId,
      user_id: resolvedUserId,
      body: text,
      created_at: new Date().toISOString(),
    };

    // Optimistic update — comments is now Record<postId, Comment[]>
    const originalPosts = currentState.posts;
    const originalComments = currentState.comments;
    const existingForPost = originalComments[postId] ?? [];
    const posts = originalPosts.map((post) =>
        post.id === postId ? { ...post, comment_count: post.comment_count + 1 } : post
    );
    setState({ comments: { ...originalComments, [postId]: [...existingForPost, comment] }, posts });

    if (hasSupabase) {
        try {
            const { data, error } = await supabase
              .from('post_comments')
              .insert([{ post_id: postId, user_id: resolvedUserId, body: text }])
              .select('id, post_id, user_id, body, created_at')
              .single();

            if (error) throw error;

            if (data?.id) {
              const persistedComment: Comment = {
                id: data.id,
                post_id: data.post_id ?? postId,
                user_id: data.user_id,
                body: data.body ?? text,
                created_at: data.created_at ?? comment.created_at,
              };
              const latestForPost = stateRef.current.comments[postId] ?? [];
              setState({
                comments: {
                  ...stateRef.current.comments,
                  [postId]: latestForPost.map((item) => item.id === comment.id ? persistedComment : item),
                },
              });
              return persistedComment;
            }
        } catch (err: any) {
            setState({ comments: originalComments, posts: originalPosts });
            logError('addComment', err);
            setError(formatErrorMessage(err, 'Unable to add comment.'));
            throw err;
        }
    }

    return comment;
  }, []);

  const fetchComments = useCallback(async (postId: string) => {
    if (!hasSupabase) return;
    try {
      const { data, error } = await supabase
        .from('post_comments')
        .select('id, post_id, user_id, body, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      const mapped: Comment[] = (data ?? []).map((row: any) => ({
        id: row.id,
        post_id: row.post_id,
        user_id: row.user_id,
        body: row.body ?? '',
        created_at: row.created_at,
      }));
      setState({ comments: { ...stateRef.current.comments, [postId]: mapped } });
    } catch (err) {
      logError('fetchComments', err);
    }
  }, []);

  const updateBookingClientLocation = useCallback(async (bookingId: string, latitude: number, longitude: number) => {
    if (!hasSupabase) return;
    const userId = stateRef.current.currentUser?.id;
    if (!userId) return;

    // Reliability Assertion: Deterministic boundary check
    try {
      assertSouthAfricanLocation(latitude, longitude);
    } catch (err: any) {
      logError('geo_assertion_client', err);
      // Log and ignore invalid data to prevent out-of-bounds telemetry
      return;
    }

    await supabase
      .from('bookings')
      .update({ user_latitude: latitude, user_longitude: longitude, updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('client_id', userId);

    const updated = stateRef.current.bookings.map((booking) =>
      booking.id === bookingId ? { ...booking, user_latitude: latitude, user_longitude: longitude } : booking
    );
    setState({ bookings: updated });
  }, []);

  const updatePhotographerLocation = useCallback(async (latitude: number, longitude: number) => {
    if (!hasSupabase) return;
    const user = stateRef.current.currentUser;
    const userId = user?.id;
    if (!userId) return;

    try {
      assertSouthAfricanLocation(latitude, longitude);
    } catch (err: any) {
      logError('geo_assertion', err);
      return;
    }

    const table = user.role === 'model' ? 'models' : 'photographers';
    
    await supabase
      .from(table)
      .update({ latitude, longitude })
      .eq('id', userId);

    if (user.role === 'model') {
      const updated = stateRef.current.models.map((m) =>
        m.id === userId ? { ...m, latitude, longitude } : m
      );
      setState({ models: updated });
    } else {
      const updated = stateRef.current.photographers.map((p) =>
        p.id === userId ? { ...p, latitude, longitude } : p
      );
      setState({ photographers: updated });
    }
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      role: UserRole = 'client',
      fullName?: string,
      dob?: string,
      extras?: { gender?: AppUser['gender']; city?: string; phone?: string }
    ) => {
      setAuthenticating(true);
      setError(null);
      try {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { verified: false },
          },
        });
        if (signUpError) {
          setError(formatAuthError(signUpError));
          return null;
        }
        if (data.user) {
          // Save full_name and role to profiles on signup
          const ageVerified = Boolean(dob);
          const trimmedCity = extras?.city?.trim() || null;
          const trimmedPhone = extras?.phone?.trim() || null;
          const normalizedGender = extras?.gender ?? null;
          const requiresKyc = role === 'photographer' || role === 'model';
          await supabase.from('profiles').upsert({
            id: data.user.id,
            role,
            verified: false,
            kyc_status: requiresKyc ? 'pending' : null,
            full_name: fullName ?? null,
            city: trimmedCity,
            phone: trimmedPhone,
            date_of_birth: dob ?? null,
            age_verified: ageVerified,
            age_verified_at: ageVerified ? new Date().toISOString() : null,
            contact_details: {
              gender: normalizedGender,
            },
          });

          // Auto-create photographer row if user signs up as photographer
          if (role === 'photographer') {
            await supabase.from('photographers').upsert({
              id: data.user.id,
              rating: 5.0,
              location: '',
              price_range: '',
              style: '',
              bio: '',
              tags: [],
              name: fullName ?? null,
            });
          }

          // Auto-create model row if user signs up as model
          if (role === 'model') {
            await supabase.from('models').upsert({
              id: data.user.id,
              rating: 5.0,
              location: '',
              price_range: '',
              style: '',
              bio: '',
              tags: [],
              portfolio_urls: [],
            });
          }
        }
        const user: AppUser | null = data.user ? mapSupabaseUser(data.user, role, {
          role,
          verified: false,
          kyc_status: role === 'photographer' || role === 'model' ? 'pending' : null,
          city: extras?.city?.trim() || null,
          phone: extras?.phone?.trim() || null,
          date_of_birth: dob ?? null,
          age_verified: Boolean(dob),
          age_verified_at: dob ? new Date().toISOString() : null,
          contact_details: {
            gender: extras?.gender ?? null,
          },
        }) : null;
        if (data.session) {
          setState({ currentUser: user });
        }
        return user;
      } catch (err: any) {
        logError('sign_up', err);
        setError(formatAuthError(err, 'Unable to sign up.'));
        return null;
      } finally {
        setAuthenticating(false);
      }
    },
    []
  );

  const signIn = useCallback(async (email: string, password: string) => {
    setAuthenticating(true);
    setError(null);
    try {
      if (__DEV__) console.log('Attempting sign in for:', email);
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        console.error('SignIn Error:', signInError);
        setError(signInError.message);
        return null;
      }
      if (__DEV__) console.log('SignIn Successful, fetching profile for:', data.user?.id);
      const profile = data.user ? await fetchProfile(data.user.id) : null;
      if (__DEV__) console.log('Profile fetched:', profile);
      const metadataRole = data.user?.user_metadata?.role as AppUser['role'] | undefined;
      const safeFallbackRole: AppUser['role'] =
        metadataRole && ['client', 'photographer', 'model', 'admin', 'guest'].includes(metadataRole)
          ? metadataRole
          : 'client';
      const user: AppUser | null = data.user ? mapSupabaseUser(data.user, safeFallbackRole, profile) : null;
      setState({ currentUser: user });
      return user;
    } catch (err: any) {
      console.error('SignIn Catch Block:', err);
      setError(err.message ?? 'Unable to sign in.');
      return null;
    } finally {
      setAuthenticating(false);
    }
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    setAuthenticating(true);
    setError(null);
    try {
      if (hasSupabase) {
        try {
          await supabase.auth.signOut();
        } catch (e) {
          logError('supabase_sign_out', e);
        }
      }
      
      // Force clear cache the moment they click sign out
      await AsyncStorage.removeItem(STORAGE_KEY);
      
      setState({ 
        ...initialState, 
        currentUser: null, 
        loading: false, // Don't show loader on login screen
        bookings: [], 
        conversations: [], 
        messages: {},
        profiles: [],
        posts: stateRef.current.posts.map(p => ({ ...p, liked: false }))
      });

      if (hasSupabase && typeof window !== 'undefined') {
        window.localStorage?.removeItem('supabase.auth.token');
      }
    } catch (err: any) {
      setError(err.message ?? 'Unable to sign out.');
    } finally {
      setAuthenticating(false);
    }
  }, []);

  const revalidateSession = useCallback(async (): Promise<AppUser | null> => {
    if (!hasSupabase) {
      return stateRef.current.currentUser;
    }

    try {
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      if (!data.user) {
        setState({ currentUser: null });
        return null;
      }

      const profile = await fetchProfile(data.user.id);
      const currentRole = profile?.role || stateRef.current.currentUser?.role || 'client';
      const user = mapSupabaseUser(data.user, currentRole as any, profile);
      setState({ currentUser: user });
      return user;
    } catch (err) {
      logError('revalidate_session', err);
      setError(formatErrorMessage(err, 'Unable to validate your current session.'));
      return null;
    }
  }, [fetchProfile]);

  const signInWithOAuth = useCallback(async (provider: 'google' | 'apple') => {
    setState({ authenticating: true, error: null });
    try {
      const redirectTo = Constants.appOwnership === 'expo' ? Linking.createURL('auth') : 'papzi://auth';
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

        if (result.type === 'cancel' || result.type === 'dismiss') {
          return;
        }

        if (result.type === 'success' && result.url) {
          const query = parseAuthCallbackParams(result.url);

          const code = typeof query.code === 'string' ? query.code : null;
          const accessToken = typeof query.access_token === 'string' ? query.access_token : null;
          const refreshToken = typeof query.refresh_token === 'string' ? query.refresh_token : null;
          const errorDescription = typeof query.error_description === 'string' ? query.error_description : null;

          if (errorDescription) {
            throw new Error(errorDescription);
          }

          if (accessToken && refreshToken) {
            const { error: sessionErr } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (sessionErr) throw sessionErr;
          } else if (code) {
            const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
            if (exchangeError) throw exchangeError;
          }
        }

        let sessionData: Awaited<ReturnType<typeof supabase.auth.getSession>>['data'] | null = null;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const { data: nextSession, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (nextSession.session) {
            sessionData = nextSession;
            break;
          }
          await sleep(250);
        }
        if (!sessionData?.session) {
          throw new Error('Auth session missing. Please try signing in again.');
        }

        await revalidateSession();
      }
    } catch (err: any) {
      logError(`oauth_${provider}`, err);
      setError(formatErrorMessage(err, `Unable to sign in with ${provider}.`));
      throw err;
    } finally {
      setState({ authenticating: false });
    }
  }, [revalidateSession]);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const currentUser = await revalidateSession();
      const userId = currentUser?.id ?? null;
      await Promise.all([
        fetchPhotographers(), 
        fetchModels(), 
        fetchBookings(userId),
        fetchConversations(userId),
        fetchEarnings(userId || ''),
        fetchSubscriptions(userId),
        fetchCredits(userId),
        fetchPosts({ reset: true })
      ]);
    } catch (err) {
      logError('refresh', err);
    } finally {
      setLoading(false);
    }
  }, [fetchBookings, fetchConversations, fetchCredits, fetchEarnings, fetchSubscriptions, fetchModels, fetchPhotographers, fetchPosts, revalidateSession]);

  const resetState = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const currentUser = stateRef.current.currentUser;
      await AsyncStorage.removeItem(STORAGE_KEY);
      setState({ ...initialState, currentUser });
    } catch (err) {
      logError('reset_state', err);
      setError('Unable to reset local data.');
    } finally {
      setSaving(false);
    }
  }, []);

  const updatePrivacy = useCallback(async (changes: Partial<PrivacySettings>) => {
    const currentState = stateRef.current;
    const userId = currentState.currentUser?.id;
    if (!userId) {
      const msg = 'You need to be logged in to change your privacy settings';
      setError(msg);
      throw new Error(msg);
    }

    // Optimistic update
    const originalPrivacy = currentState.privacy;
    const privacy = { ...originalPrivacy, ...changes };
    setState({ privacy });

    if (hasSupabase) {
        try {
            const consentTypeBySetting: Record<'marketingOptIn' | 'personalizedAds' | 'locationEnabled', string> = {
              marketingOptIn: 'marketing',
              personalizedAds: 'personalized_ads',
              locationEnabled: 'location_tracking',
            };

            const consentEntries = (Object.entries(changes) as Array<[keyof PrivacySettings, unknown]>)
              .filter(([key, value]) =>
                (key === 'marketingOptIn' || key === 'personalizedAds' || key === 'locationEnabled') &&
                typeof value === 'boolean'
              ) as Array<['marketingOptIn' | 'personalizedAds' | 'locationEnabled', boolean]>;

            for (const [setting, enabled] of consentEntries) {
              const consentType = consentTypeBySetting[setting];
              await recordComplianceConsent({
                consent_type: consentType,
                enabled,
                legal_basis: 'consent',
                consent_version: '1.0',
                context: { setting, source: 'privacy_settings' },
              });
            }
        } catch(err: any) {
            // Revert
            setState({ privacy: originalPrivacy });
            const msg = formatErrorMessage(err, 'Unable to update your privacy settings.');
            setError(msg);
            throw new Error(msg);
        }
    }
  }, []);

  const requestDataDeletion = useCallback(async () => {
    const currentState = stateRef.current;
    const userId = currentState.currentUser?.id;
    if (!userId) {
      const msg = 'You need to be logged in to delete your data';
      setError(msg);
      throw new Error(msg);
    }

    const originalPrivacy = currentState.privacy;
    const requestedAt = new Date().toISOString();
    setState({ privacy: { ...originalPrivacy, dataDeletionRequestedAt: requestedAt } });

    if (hasSupabase) {
        try {
            const { error } = await supabase.from('account_deletion_requests').insert({
              created_by: userId,
              reason: 'Requested from mobile app settings',
            });
            if (error) throw error;
        } catch(err: any) {
            setState({ privacy: originalPrivacy });
            const msg = formatErrorMessage(err, 'Unable to request data deletion.');
            setError(msg);
            throw new Error(msg);
        }
    }
  }, []);

  const updateProfilePicture = useCallback(async (uri: string) => {
    const currentState = stateRef.current;
    const userId = currentState.currentUser?.id;
    if (!userId || !hasSupabase) {
      const msg = 'You need to be logged in and online to update your profile picture.';
      setError(msg);
      throw new Error(msg);
    }
    setSaving(true);
    try {
      const finalUrl = await uploadAvatar(uri, userId);
      const versionedUrl = `${finalUrl}?v=${Date.now()}`;
      const { error: authError } = await supabase.auth.updateUser({
        data: { avatar_url: versionedUrl }
      });
      if (authError) throw authError;

      const { error: dbError } = await supabase
        .from('profiles')
        .update({ avatar_url: versionedUrl })
        .eq('id', userId);
      if (dbError) throw dbError;

      await supabase.auth.refreshSession();
      // Immediate local update so UI reflects new avatar without restart
      const currentUser = stateRef.current.currentUser;
        if (currentUser) {
          setState({
            currentUser: { ...currentUser, avatar_url: versionedUrl },
            profiles: stateRef.current.profiles.map(p =>
              p.id === userId ? { ...p, avatar_url: versionedUrl } : p
            ),
            photographers: stateRef.current.photographers.map(p =>
              p.id === userId ? { ...p, avatar_url: versionedUrl } : p
            ),
            models: stateRef.current.models.map(m =>
              m.id === userId ? { ...m, avatar_url: versionedUrl } : m
            ),
            posts: stateRef.current.posts.map(post =>
              post.author_id === userId
                ? { ...post, profile: { ...(post.profile ?? {}), avatar_url: versionedUrl } }
                : post
            ),
          });
        }
    } catch (err: any) {
      logError('updateProfilePicture', err);
      const msg = formatErrorMessage(err, 'Unable to update profile picture.');
      setError(msg);
      throw new Error(msg);
    } finally {
      setSaving(false);
    }
  }, []);

  const updateProfile = useCallback(async (changes: Partial<AppUser>) => {
    const userId = stateRef.current.currentUser?.id;
    const currentRole = stateRef.current.currentUser?.role;
    const newRole = changes.role ?? currentRole;
    if (!userId || !hasSupabase) {
      const msg = 'You need to be logged in and online to update your profile.';
      setError(msg);
      throw new Error(msg);
    }

    setSaving(true);
    try {
      // 1. Build profile upsert payload — upsert creates or updates the row
      const profileChanges: any = { id: userId };
      if (changes.full_name !== undefined) profileChanges.full_name = changes.full_name;
      if (changes.bio !== undefined) profileChanges.bio = changes.bio;
      if (changes.phone !== undefined) profileChanges.phone = changes.phone;
      if (changes.city !== undefined) profileChanges.city = changes.city;
      if (changes.username !== undefined) profileChanges.username = changes.username;
      if (changes.website !== undefined) profileChanges.website = changes.website;
      if (changes.instagram !== undefined) profileChanges.instagram = changes.instagram;
      if (changes.avatar_url !== undefined) profileChanges.avatar_url = changes.avatar_url;
      if (changes.contact_details !== undefined) profileChanges.contact_details = changes.contact_details;
      if (changes.push_token !== undefined) profileChanges.push_token = changes.push_token;
      // Role is included so RoleSelectionScreen can set it for new OAuth users
      if (changes.role !== undefined) profileChanges.role = changes.role;

      if (Object.keys(profileChanges).length > 1) { // more than just the id
        const { error } = await supabase
          .from('profiles')
          .upsert(profileChanges, { onConflict: 'id' });
        if (error) throw error;
      }

      // 2. When a role is first selected, auto-create the role-specific table row
      if (changes.role && changes.role !== currentRole) {
        if (changes.role === 'photographer') {
          await supabase.from('photographers').upsert({
            id: userId,
            rating: 5.0,
            location: '',
            price_range: '$$',
            style: 'Portrait',
            bio: '',
            tags: [],
          }, { onConflict: 'id' });
        } else if (changes.role === 'model') {
          await supabase.from('models').upsert({
            id: userId,
            rating: 5.0,
            location: '',
            price_range: '$$',
            style: 'Commercial',
            bio: '',
            tags: [],
            portfolio_urls: [],
          }, { onConflict: 'id' });
        }
      }

      // 3. Sync bio to role-specific table if bio changed
      if (changes.bio !== undefined) {
        if (newRole === 'photographer') {
          await supabase.from('photographers').update({ bio: changes.bio }).eq('id', userId);
        } else if (newRole === 'model') {
          await supabase.from('models').update({ bio: changes.bio }).eq('id', userId);
        }
      }

      // 4. Immediate local state feedback across all profile-backed collections.
      const currentUserState = stateRef.current.currentUser;
      if (!currentUserState) {
        throw new Error('Profile update requires an authenticated user.');
      }
      const nextCurrentUser = { ...currentUserState, ...changes };
      setState({
        currentUser: nextCurrentUser,
        profiles: stateRef.current.profiles.map((p: any) =>
          p.id === userId
            ? {
                ...p,
                full_name: changes.full_name !== undefined ? changes.full_name : p.full_name,
                avatar_url: changes.avatar_url !== undefined ? changes.avatar_url : p.avatar_url,
                bio: changes.bio !== undefined ? changes.bio : p.bio,
                city: changes.city !== undefined ? changes.city : p.city,
                username: changes.username !== undefined ? changes.username : p.username,
                instagram: changes.instagram !== undefined ? changes.instagram : p.instagram,
                website: changes.website !== undefined ? changes.website : p.website,
              }
            : p
        ),
        photographers: stateRef.current.photographers.map((p: any) =>
          p.id === userId
            ? {
                ...p,
                name: changes.full_name !== undefined ? changes.full_name : p.name,
                bio: changes.bio !== undefined ? changes.bio : p.bio,
                city: changes.city !== undefined ? changes.city : p.city,
                instagram: changes.instagram !== undefined ? changes.instagram : p.instagram,
                website: changes.website !== undefined ? changes.website : p.website,
              }
            : p
        ),
        models: stateRef.current.models.map((m: any) =>
          m.id === userId
            ? {
                ...m,
                name: changes.full_name !== undefined ? changes.full_name : m.name,
                bio: changes.bio !== undefined ? changes.bio : m.bio,
                city: changes.city !== undefined ? changes.city : m.city,
                instagram: changes.instagram !== undefined ? changes.instagram : m.instagram,
                website: changes.website !== undefined ? changes.website : m.website,
              }
            : m
        ),
      });
    } catch (err: any) {
      logError('updateProfile', err);
      const msg = formatErrorMessage(err, 'Unable to update profile.');
      setError(msg);
      throw new Error(msg);
    } finally {
      setSaving(false);
    }
  }, []);

  const updateProviderSettings = useCallback(async (payload: { tier_id?: string | null; equipment?: any | null }) => {
    const current = stateRef.current.currentUser;
    if (!current) throw new Error('Not signed in.');
    const role = current.role;
    if (role !== 'photographer' && role !== 'model') return;
    if (!hasSupabase) return;

    const table = role === 'model' ? 'models' : 'photographers';
    const { data, error } = await supabase
      .from(table)
      .update({
        tier_id: payload.tier_id ?? null,
        equipment: payload.equipment ?? null,
      })
      .eq('id', current.id)
      .select('*')
      .maybeSingle();

    if (error) throw error;

    if (role === 'model') {
      const updated = stateRef.current.models.map((m) =>
        m.id === current.id ? { ...m, tier_id: data?.tier_id ?? payload.tier_id ?? null, equipment: data?.equipment ?? payload.equipment ?? null } : m
      );
      setState({ models: updated });
    } else {
      const updated = stateRef.current.photographers.map((p) =>
        p.id === current.id ? { ...p, tier_id: data?.tier_id ?? payload.tier_id ?? null, equipment: data?.equipment ?? payload.equipment ?? null } : p
      );
      setState({ photographers: updated });
    }
  }, []);


  const value = useMemo<AppDataContextValue>(() => ({
      state,
      loading: state.loading,
      saving: state.saving,
      authenticating: state.authenticating,
      error: state.error,
      currentUser: state.currentUser,
      createBooking,
      updateBookingStatus,
      sendMessage,
      sendLockedMediaMessage,
      fetchMessages,
      fetchMessagesForChat,
      fetchComments,
      updateBookingClientLocation,
      updatePhotographerLocation,
      startConversationWithUser,
      addPost,
      toggleLike,
      addComment,
      setState,
      signUp,
      signIn,
      signInWithOAuth,
      signOut,
      fetchPosts,
      fetchProfiles,
      updatePrivacy,
      requestDataDeletion,
      refresh,
      revalidateSession,
      resetState,
      updateProfilePicture,
      updateProfile,
      updateProviderSettings,
      fetchEarnings,
      fetchSubscriptions,
      fetchCredits,
      fetchNotifications,
      adjustCredits,
      redeemCreditsCode,
    }),
    [state, createBooking, updateBookingStatus, sendMessage, sendLockedMediaMessage, fetchMessages, fetchMessagesForChat, fetchComments, updateBookingClientLocation, updatePhotographerLocation, startConversationWithUser, addPost, toggleLike, addComment, setState, signUp, signIn, signOut, updatePrivacy, requestDataDeletion, refresh, revalidateSession, resetState, updateProfilePicture, updateProfile, updateProviderSettings, fetchEarnings, fetchSubscriptions, fetchCredits, fetchNotifications, adjustCredits, redeemCreditsCode]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
};

export const useAppData = (): AppDataContextValue => {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppData must be used within an AppDataProvider');
  }
  return context;
};
