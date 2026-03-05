import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialState } from '../data/initialData';
import { supabase } from '../config/supabaseClient';
import { AppState, AppUser, Booking, BookingStatus, Comment, Message, Photographer, Post, PrivacySettings } from '../types';
import { uid } from '../utils/id';
import { formatAuthError, formatErrorMessage, logError } from '../utils/errors';

type CreateBookingInput = {
  photographerId: string;
  date: string;
  package: string;
  notes?: string;
  pricingMode?: 'paparazzi' | 'event';
  photoCount?: number;
  eventPackageId?: string;
  distanceKm?: number;
  priceTotal?: number;
  currency?: string;
  userLatitude?: number;
  userLongitude?: number;
};

type CreatePostInput = {
  caption: string;
  imageUri: string;
  location?: string;
  userId?: string;
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
  updateBookingStatus: (bookingId: string, forcedStatus?: BookingStatus) => Promise<Booking | undefined>;
  sendMessage: (chatId: string, text: string, fromUser?: boolean) => Promise<Message>;
  fetchMessagesForChat: (chatId: string) => Promise<void>;
  markConversationRead: (chatId: string) => Promise<void>;
  getOrCreateBookingConversation: (bookingId: string, photographerId: string) => Promise<string>;
  addPost: (payload: CreatePostInput) => Promise<Post>;
  toggleLike: (postId: string) => Promise<Post | undefined>;
  addComment: (postId: string, text: string, userId?: string) => Promise<Comment>;
  fetchCommentsForPost: (postId: string) => Promise<Comment[]>;
  trackEvent: (name: string, metadata?: Record<string, any>) => Promise<void>;
  signUp: (email: string, password: string, role?: AppUser['role']) => Promise<AppUser | null>;
  signIn: (email: string, password: string) => Promise<AppUser | null>;
  signOut: () => Promise<void>;
  updatePrivacy: (changes: Partial<PrivacySettings>) => Promise<void>;
  requestDataDeletion: (reason?: string) => Promise<void>;
  resetState: () => Promise<void>;
};

const STORAGE_KEY = 'movable-app-state-v1';
const RESET_MARKER_KEY = 'movable-app-reset-applied';
const RESET_MARKER_VALUE = 'schema-reset-2026-01';

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

type ProfileRow = { role?: AppUser['role']; verified?: boolean } | null;

type PhotographerProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  city: string | null;
} | null;

type PhotographerRow = {
  id: string;
  rating: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  is_available: boolean | null;
  price_range: string | null;
  style: string | null;
  bio: string | null;
  tags: string[] | null;
  profiles: PhotographerProfileRow | PhotographerProfileRow[];
};

const FALLBACK_AVATAR = 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=300&q=80';
const PHOTOGRAPHER_SELECT = `
  id,
  rating,
  location,
  latitude,
  longitude,
  is_available,
  price_range,
  style,
  bio,
  tags,
  profiles:profiles(id, full_name, avatar_url, city)
`;

const mapSupabaseUser = (user: any, fallbackRole: AppUser['role'] = 'client', profile: ProfileRow = null): AppUser => ({
  id: user.id,
  email: user.email ?? 'unknown-user',
  role: (profile?.role as AppUser['role']) ?? ((user.user_metadata as any)?.role as AppUser['role']) ?? fallbackRole,
  verified: profile?.verified ?? Boolean((user.user_metadata as any)?.verified ?? false),
});

const normalizeStoredUser = (user: AppUser | null | undefined): AppUser | null =>
  user
    ? {
        ...user,
        verified: Boolean((user as any).verified),
      }
    : null;

const mapPhotographerRow = (row: PhotographerRow): Photographer => {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const fallbackLocation = profile?.city ? `${profile.city}, South Africa` : 'South Africa';
  return {
    id: row.id,
    name: profile?.full_name ?? 'New photographer',
    avatar: profile?.avatar_url ?? FALLBACK_AVATAR,
    rating: typeof row.rating === 'number' ? row.rating : 0,
    location: row.location ?? fallbackLocation,
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
    isAvailable: row.is_available ?? true,
    style: row.style ?? '',
    bio: row.bio ?? '',
    priceRange: row.price_range ?? 'R1500',
    tags: row.tags ?? [],
  };
};

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistInitialSnapshot = useCallback(async () => {
    await AsyncStorage.multiSet([
      [RESET_MARKER_KEY, RESET_MARKER_VALUE],
      [STORAGE_KEY, JSON.stringify(initialState)],
    ]);
  }, []);

  const ensureFreshStorage = useCallback(async () => {
    try {
      const marker = await AsyncStorage.getItem(RESET_MARKER_KEY);
      if (marker === RESET_MARKER_VALUE) return;
      await AsyncStorage.clear();
      await persistInitialSnapshot();
      setState(initialState);
    } catch (storageError) {
      console.warn('Failed to clear AsyncStorage during reset', storageError);
      setError('Unable to reset local data. Please restart the app.');
    }
  }, [persistInitialSnapshot]);

  const fetchProfile = useCallback(async (userId: string): Promise<ProfileRow> => {
    try {
      const { data } = await supabase.from('profiles').select('role, verified').eq('id', userId).maybeSingle();
      return data ?? null;
    } catch (err) {
      logError('fetchProfile', err);
      return null;
    }
  }, []);

  const fetchPhotographers = useCallback(async () => {
    try {
      const { data, error: photographerError } = await supabase
        .from('photographers')
        .select(PHOTOGRAPHER_SELECT)
        .order('rating', { ascending: false });
      if (photographerError) {
        throw photographerError;
      }
      const mapped = (data ?? []).map(mapPhotographerRow);
      setState((prev) => ({ ...prev, photographers: mapped }));
    } catch (err: any) {
      logError('fetch_photographers', err);
      setError(formatErrorMessage(err, 'Unable to load photographers right now.'));
    }
  }, []);

  const fetchBookings = useCallback(async () => {
    try {
      const { data, error: bookingError } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false });

      if (bookingError) {
        throw bookingError;
      }

      const mapped: Booking[] = (data ?? []).map((row: any) => ({
        id: row.id,
        photographerId: row.photographer_id ?? row.photographerId ?? '',
        date: row.requested_date ?? row.date ?? row.booking_date ?? '',
        package: row.package ?? row.package_name ?? 'Booking',
        notes: row.notes ?? undefined,
        status: (row.status ?? 'pending') as BookingStatus,
        createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
        pricingMode: row.pricing_mode ?? undefined,
        priceTotal: row.price_total ?? undefined,
        currency: row.currency ?? undefined,
        userLatitude: row.user_latitude ?? undefined,
        userLongitude: row.user_longitude ?? undefined,
      }));

      setState((prev) => ({ ...prev, bookings: mapped }));
    } catch (err: any) {
      logError('fetch_bookings', err);
      setError(formatErrorMessage(err, 'Unable to load bookings right now.'));
    }
  }, []);

  const hydratePhotographer = useCallback(
    async (photographerId: string): Promise<Photographer | null> => {
      if (!photographerId) return null;
      try {
        const { data, error: photographerError } = await supabase
          .from('photographers')
          .select(PHOTOGRAPHER_SELECT)
          .eq('id', photographerId)
          .maybeSingle();
        if (photographerError) {
          throw photographerError;
        }
        return data ? mapPhotographerRow(data as PhotographerRow) : null;
      } catch (err) {
        logError('hydrate_photographer', err);
        return null;
      }
    },
    []
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await ensureFreshStorage();
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
          const parsed: AppState = JSON.parse(stored);
          setState({
            ...initialState,
            ...parsed,
            photographers: initialState.photographers,
            currentUser: normalizeStoredUser(parsed.currentUser),
            conversations: parsed.conversations ?? initialState.conversations,
          });
        }
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          const profile = await fetchProfile(data.user.id);
          const hydratedUser = mapSupabaseUser(data.user, 'client', profile);
          setState((prev) => ({ ...prev, currentUser: hydratedUser }));
          await fetchBookings();
        }
        await fetchPhotographers();
      } catch (err) {
        logError('load_state', err);
        setError('Unable to load saved data.');
      } finally {
        setHydrated(true);
        setLoading(false);
      }
    };

    load();
  }, [ensureFreshStorage, fetchPhotographers, fetchProfile, fetchBookings]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(async (_, session) => {
      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        setState((prev) => ({
          ...prev,
          currentUser: mapSupabaseUser(session.user, prev.currentUser?.role ?? 'client', profile),
        }));
      } else {
        setState((prev) => ({ ...prev, currentUser: null }));
      }
    });

    return () => {
      data.subscription?.unsubscribe();
    };
  }, [fetchProfile]);

  useEffect(() => {
    if (!hydrated) return;
    const persist = async () => {
      setSaving(true);
      try {
        const stateToPersist: AppState = { ...state, photographers: initialState.photographers };
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateToPersist));
      } catch (err) {
        console.warn('Failed to persist state', err);
        setError('Unable to save data locally.');
      } finally {
        setSaving(false);
      }
    };
    persist();
  }, [state, hydrated]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: AppState = JSON.parse(stored);
        setState({
          ...initialState,
          ...parsed,
          currentUser: normalizeStoredUser(parsed.currentUser),
          conversations: parsed.conversations ?? initialState.conversations,
        });
      } else {
        setState(initialState);
      }
    } catch (err) {
      logError('refresh_state', err);
      setError('Unable to refresh data.');
    } finally {
      setLoading(false);
    }
  }, []);

  const revalidateSession = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: sessionError } = await supabase.auth.getUser();
      if (sessionError) {
        setError(formatAuthError(sessionError, 'Session could not be refreshed.'));
        return null;
      }
      if (data.user) {
        const profile = await fetchProfile(data.user.id);
        const user = mapSupabaseUser(data.user, state.currentUser?.role ?? 'client', profile);
        setState((prev) => ({ ...prev, currentUser: user }));
        return user;
      }
      setState((prev) => ({ ...prev, currentUser: null }));
      return null;
    } catch (err: any) {
      logError('revalidate_session', err);
      setError(formatAuthError(err, 'Unable to revalidate session.'));
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchProfile, state.currentUser?.role]);

  const trackEvent = useCallback(
    async (name: string, metadata?: Record<string, any>) => {
      try {
        await supabase.from('analytics_events').insert({
          name,
          created_by: state.currentUser?.id ?? null,
          metadata: metadata ?? null,
        });
      } catch (err) {
        logError('track_event', err);
      }
    },
    [state.currentUser?.id]
  );

  const refreshPostMetrics = useCallback(async (postId: string) => {
    try {
      const { data, error: metricError } = await supabase
        .from('posts')
        .select('id, likes_count, comment_count')
        .eq('id', postId)
        .maybeSingle();
      if (metricError || !data) return;
      setState((prev) => ({
        ...prev,
        posts: prev.posts.map((post) =>
          post.id === postId
            ? {
                ...post,
                likes: data.likes_count ?? post.likes,
                commentCount: data.comment_count ?? post.commentCount,
              }
            : post
        ),
      }));
    } catch (err) {
      logError('refresh_post_metrics', err);
    }
  }, []);


  const createBooking = useCallback(
    async (payload: CreateBookingInput) => {
      const clientId = state.currentUser?.id;
      if (!clientId) {
        const message = 'You need to be signed in to create a booking.';
        setError(message);
        throw new Error(message);
      }

      try {
        const { data, error: insertError } = await supabase
          .from('bookings')
          .insert({
            client_id: clientId,
            photographer_id: payload.photographerId,
            requested_date: payload.date,
            package: payload.package,
            notes: payload.notes ?? null,
            pricing_mode: payload.pricingMode ?? null,
            photo_count: payload.photoCount ?? null,
            event_package_id: payload.eventPackageId ?? null,
            distance_km: payload.distanceKm ?? null,
            price_total: payload.priceTotal ?? null,
            currency: payload.currency ?? null,
            user_latitude: payload.userLatitude ?? null,
            user_longitude: payload.userLongitude ?? null,
            status: 'pending',
          })
          .select('id, client_id, photographer_id, requested_date, package, notes, status, created_at')
          .single();

        if (insertError) throw insertError;

        const booking: Booking = {
          id: data?.id ?? uid('booking'),
          photographerId: data?.photographer_id ?? payload.photographerId,
          date: data?.requested_date ?? payload.date,
          package: data?.package ?? payload.package,
          notes: data?.notes ?? payload.notes,
          status: (data?.status ?? 'pending') as BookingStatus,
          createdAt: data?.created_at ?? new Date().toISOString(),
        };

        setState((prev) => ({ ...prev, bookings: [booking, ...prev.bookings] }));
        await trackEvent('booking_created', { bookingId: booking.id });
        return booking;
      } catch (err: any) {
        logError('create_booking', err);
        const message = formatErrorMessage(err, 'Unable to create your booking right now.');
        setError(message);
        throw new Error(message);
      }
    },
    [state.currentUser?.id, trackEvent]
  );

  const updateBookingStatus = useCallback(async (bookingId: string, forcedStatus?: BookingStatus) => {
    const nextStatus = (current: BookingStatus): BookingStatus => {
      const order: BookingStatus[] = ['pending', 'accepted', 'completed', 'reviewed'];
      const index = order.indexOf(current);
      return order[Math.min(index + 1, order.length - 1)];
    };

    const target = state.bookings.find((booking) => booking.id === bookingId);
    if (!target) return undefined;

    const status = forcedStatus ?? nextStatus(target.status);
    if (status === target.status) return target;
    try {
      const { data, error: updateError } = await supabase
        .from('bookings')
        .update({ status })
        .eq('id', bookingId)
        .select('id, client_id, photographer_id, requested_date, package, notes, status, created_at')
        .single();

      if (updateError) throw updateError;

      const updatedBooking: Booking = {
        id: data?.id ?? bookingId,
        photographerId: data?.photographer_id ?? target.photographerId,
        date: data?.requested_date ?? target.date,
        package: data?.package ?? target.package,
        notes: data?.notes ?? target.notes,
        status: (data?.status ?? status) as BookingStatus,
        createdAt: data?.created_at ?? target.createdAt,
      };

      setState((prev) => ({
        ...prev,
        bookings: prev.bookings.map((booking) => (booking.id === bookingId ? updatedBooking : booking)),
      }));
      return updatedBooking;
    } catch (err: any) {
      logError('update_booking_status', err);
      setError(formatErrorMessage(err, 'Unable to update booking status.'));
      return undefined;
    }
  }, [state.bookings]);

  const sendMessage = useCallback(
    async (chatId: string, text: string, fromUser = true) => {
      const senderId = state.currentUser?.id;
      if (!senderId) {
        const message = 'You need to be signed in to send messages.';
        setError(message);
        throw new Error(message);
      }

      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error('Message text is required.');
      }

      try {
        const { data, error: insertError } = await supabase
          .from('messages')
          .insert({
            chat_id: chatId,
            body: trimmed,
            sender_id: senderId,
          })
          .select('id, chat_id, sender_id, body, created_at')
          .single();

        if (insertError) {
          throw insertError;
        }

        const message: Message = {
          id: data?.id ?? uid('msg'),
          chatId: data?.chat_id ?? chatId,
          fromUser,
          text: data?.body ?? trimmed,
          timestamp: data?.created_at ?? new Date().toISOString(),
        };

        await supabase
          .from('conversations')
          .update({ last_message: trimmed, last_message_at: new Date().toISOString() })
          .eq('id', chatId);

        setState((prev) => ({ ...prev, messages: [...prev.messages, message] }));
        await trackEvent('message_sent', { chatId });
        return message;
      } catch (err: any) {
        logError('send_message', err);
        const friendly = formatErrorMessage(err, 'Unable to send your message right now.');
        setError(friendly);
        throw new Error(friendly);
      }
    },
    [state.currentUser?.id, trackEvent]
  );

  const fetchMessagesForChat = useCallback(
    async (chatId: string) => {
      try {
        const { data, error: fetchError } = await supabase
          .from('messages')
          .select('id, chat_id, sender_id, body, created_at')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true });

        if (fetchError) {
          logError('fetch_messages_for_chat', fetchError);
          return;
        }

        const currentUserId = state.currentUser?.id;
        const mapped: Message[] = (data ?? []).map((row: any) => ({
          id: row.id,
          chatId: row.chat_id ?? chatId,
          fromUser: row.sender_id === currentUserId,
          text: row.body ?? '',
          timestamp: row.created_at ?? new Date().toISOString(),
        }));

        setState((prev) => {
          const others = prev.messages.filter((m) => m.chatId !== chatId);
          return { ...prev, messages: [...others, ...mapped] };
        });
      } catch (err) {
        logError('fetch_messages_for_chat', err);
      }
    },
    [state.currentUser?.id]
  );

  const markConversationRead = useCallback(
    async (chatId: string) => {
      const userId = state.currentUser?.id;
      if (!userId) return;
      try {
        await supabase
          .from('conversation_participants')
          .update({ last_read_at: new Date().toISOString() })
          .eq('conversation_id', chatId)
          .eq('user_id', userId);
      } catch (err) {
        logError('mark_conversation_read', err);
      }
    },
    [state.currentUser?.id]
  );

  const getOrCreateBookingConversation = useCallback(
    async (bookingId: string, photographerId: string) => {
      const userId = state.currentUser?.id;
      if (!userId) {
        throw new Error('You must be signed in to start a chat.');
      }

      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('booking_id', bookingId)
        .maybeSingle();

      if (existing?.id) return existing.id;

      const title = `Booking chat · ${new Date().toLocaleDateString()}`;
      const { data: conversation, error: insertError } = await supabase
        .from('conversations')
        .insert({
          title,
          created_by: userId,
          booking_id: bookingId,
          last_message: 'Say hello 👋',
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError || !conversation?.id) {
        throw insertError ?? new Error('Unable to create a conversation.');
      }

      await supabase.from('conversation_participants').insert([
        { conversation_id: conversation.id, user_id: userId },
        { conversation_id: conversation.id, user_id: photographerId },
      ]);

      return conversation.id;
    },
    [state.currentUser?.id]
  );

  const addPost = useCallback(
    async ({ caption, imageUri, location, userId }: CreatePostInput) => {
      const ownerId = userId ?? state.currentUser?.id;
      if (!ownerId) {
        const message = 'You need an account to publish a post.';
        setError(message);
        throw new Error(message);
      }

      try {
        const insertPost = async () =>
          supabase
            .from('posts')
            .insert({
              user_id: ownerId,
              caption,
              location,
              image_url: imageUri,
            })
            .select(
              `
              id,
              user_id,
              caption,
              location,
              comment_count,
              created_at,
              image_url,
              likes_count
            `
            )
            .single();

        let { data, error: insertError } = await insertPost();

        if (insertError) {
          const message = String((insertError as any)?.message ?? '');
          const isForeignKey = (insertError as any)?.code === '23503' || message.includes('foreign key');
          if (isForeignKey) {
            await supabase.from('profiles').upsert({
              id: ownerId,
              role: state.currentUser?.role ?? 'client',
              verified: false,
            });
            const retry = await insertPost();
            data = retry.data;
            insertError = retry.error;
          }
        }

        if (insertError) {
          throw insertError;
        }

        const post: Post = {
          id: data?.id ?? uid('post'),
          userId: data?.user_id ?? ownerId,
          caption: data?.caption ?? caption,
          imageUri: data?.image_url ?? imageUri,
          createdAt: data?.created_at ?? new Date().toISOString(),
          likes: data?.likes_count ?? 0,
          liked: false,
          commentCount: data?.comment_count ?? 0,
          location: data?.location ?? location,
        };

        setState((prev) => ({ ...prev, posts: [post, ...prev.posts] }));
        await trackEvent('post_created', { postId: post.id });
        return post;
      } catch (err: any) {
        logError('add_post', err);
        const details =
          err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string'
            ? (err as any).message
            : JSON.stringify(err);
        const message = formatErrorMessage(details, 'Unable to publish your post right now.');
        setError(message);
        throw err;
      }
    },
    [state.currentUser?.id, trackEvent]
  );

  const toggleLike = useCallback(
    async (postId: string) => {
      const userId = state.currentUser?.id;
      if (!userId) {
        throw new Error('You need to be signed in to like a post.');
      }
      try {
        const { data: existing } = await supabase
          .from('post_likes')
          .select('id')
          .eq('post_id', postId)
          .eq('user_id', userId)
          .maybeSingle();

        if (existing?.id) {
          await supabase.from('post_likes').delete().eq('id', existing.id);
          setState((prev) => ({
            ...prev,
            posts: prev.posts.map((post) =>
              post.id === postId ? { ...post, liked: false } : post
            ),
          }));
          await trackEvent('post_unliked', { postId });
        } else {
          await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
          setState((prev) => ({
            ...prev,
            posts: prev.posts.map((post) =>
              post.id === postId ? { ...post, liked: true } : post
            ),
          }));
          await trackEvent('post_liked', { postId });
        }
        await refreshPostMetrics(postId);
      } catch (err: any) {
        logError('toggle_like', err);
        throw err;
      }
      return state.posts.find((post) => post.id === postId);
    },
    [refreshPostMetrics, state.currentUser?.id, state.posts, trackEvent]
  );

  const addComment = useCallback(
    async (postId: string, text: string, userId = state.currentUser?.id ?? 'you') => {
      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error('Comment text is required.');
      }
      if (!state.currentUser?.id) {
        throw new Error('You need to be signed in to comment.');
      }
      const { data, error: insertError } = await supabase
        .from('post_comments')
        .insert({ post_id: postId, user_id: state.currentUser.id, body: trimmed })
        .select('id, post_id, user_id, body, created_at')
        .single();
      if (insertError) {
        throw insertError;
      }
      const comment: Comment = {
        id: data?.id ?? uid('comment'),
        postId: data?.post_id ?? postId,
        userId: data?.user_id ?? userId,
        text: data?.body ?? trimmed,
        createdAt: data?.created_at ?? new Date().toISOString(),
      };
      setState((prev) => ({
        ...prev,
        comments: [...prev.comments, comment],
      }));
      await refreshPostMetrics(postId);
      await trackEvent('post_commented', { postId });
      return comment;
    },
    [refreshPostMetrics, state.currentUser?.id, trackEvent]
  );

  const fetchCommentsForPost = useCallback(async (postId: string) => {
    try {
      const { data, error } = await supabase
        .from('post_comments')
        .select('id, post_id, user_id, body, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const mapped: Comment[] = (data ?? []).map((row: any) => ({
        id: row.id,
        postId: row.post_id ?? postId,
        userId: row.user_id ?? 'user',
        text: row.body ?? '',
        createdAt: row.created_at ?? new Date().toISOString(),
      }));
      setState((prev) => ({
        ...prev,
        comments: [...prev.comments.filter((c) => c.postId !== postId), ...mapped],
      }));
      return mapped;
    } catch (err) {
      logError('fetch_comments_for_post', err);
      return [];
    }
  }, []);

  const resetState = useCallback(async () => {
    try {
      await AsyncStorage.clear();
      await persistInitialSnapshot();
      setState(initialState);
    } catch (err) {
      console.warn('Failed to reset state', err);
      setError('Unable to reset data.');
    }
  }, [persistInitialSnapshot]);

  const signUp = useCallback(
    async (email: string, password: string, role: AppUser['role'] = 'client') => {
      setAuthenticating(true);
      setError(null);
      try {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { role, verified: false },
          },
        });
        if (signUpError) {
          setError(formatAuthError(signUpError));
          return null;
        }
        if (data.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            role,
            verified: false,
          });
        }
        const user: AppUser | null = data.user ? mapSupabaseUser(data.user, role, { role, verified: false }) : null;
        setState((prev) => ({ ...prev, currentUser: user }));
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
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        return null;
      }
      const profile = data.user ? await fetchProfile(data.user.id) : null;
      const user: AppUser | null = data.user ? mapSupabaseUser(data.user, 'client', profile) : null;
      setState((prev) => ({ ...prev, currentUser: user }));
      return user;
    } catch (err: any) {
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
      await supabase.auth.signOut();
      setState((prev) => ({ ...prev, currentUser: null }));
    } catch (err: any) {
      setError(err.message ?? 'Unable to sign out.');
    } finally {
      setAuthenticating(false);
    }
  }, []);

  const updatePrivacy = useCallback(async (changes: Partial<PrivacySettings>) => {
    setState((prev) => ({ ...prev, privacy: { ...prev.privacy, ...changes } }));
  }, []);

  const requestDataDeletion = useCallback(async (reason?: string) => {
    const timestamp = new Date().toISOString();
    try {
      if (state.currentUser?.id) {
        await supabase.from('account_deletion_requests').insert({
          created_by: state.currentUser.id,
          reason: reason ?? null,
        });
        await trackEvent('account_deletion_requested');
      }
    } catch (err) {
      logError('request_data_deletion', err);
    } finally {
      setState((prev) => ({
        ...prev,
        privacy: { ...prev.privacy, dataDeletionRequestedAt: timestamp },
      }));
    }
  }, [state.currentUser?.id, trackEvent]);

  const value = useMemo<AppDataContextValue>(
    () => ({
      state,
      loading,
      saving,
      authenticating,
      error,
      currentUser: state.currentUser,
      refresh,
      revalidateSession,
      createBooking,
      updateBookingStatus,
      sendMessage,
      fetchMessagesForChat,
      markConversationRead,
      getOrCreateBookingConversation,
      addPost,
      toggleLike,
      addComment,
      fetchCommentsForPost,
      trackEvent,
      signUp,
      signIn,
      signOut,
      updatePrivacy,
      requestDataDeletion,
      resetState,
    }),
    [
      state,
      loading,
      saving,
      authenticating,
      error,
      refresh,
      revalidateSession,
      createBooking,
      updateBookingStatus,
      sendMessage,
      fetchMessagesForChat,
      markConversationRead,
      getOrCreateBookingConversation,
      addPost,
      toggleLike,
      addComment,
      fetchCommentsForPost,
      trackEvent,
      signUp,
      signIn,
      signOut,
      updatePrivacy,
      requestDataDeletion,
      resetState,
    ]
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
