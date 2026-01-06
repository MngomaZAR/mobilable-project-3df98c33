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
  updateBookingStatus: (bookingId: string) => Promise<Booking | undefined>;
  sendMessage: (chatId: string, text: string, fromUser?: boolean) => Promise<Message>;
  addPost: (payload: CreatePostInput) => Promise<Post>;
  toggleLike: (postId: string) => Promise<Post | undefined>;
  addComment: (postId: string, text: string, userId?: string) => Promise<Comment>;
  signUp: (email: string, password: string, role?: AppUser['role']) => Promise<AppUser | null>;
  signIn: (email: string, password: string) => Promise<AppUser | null>;
  signOut: () => Promise<void>;
  updatePrivacy: (changes: Partial<PrivacySettings>) => Promise<void>;
  requestDataDeletion: () => Promise<void>;
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
  price_range: string | null;
  style: string | null;
  bio: string | null;
  tags: string[] | null;
  profiles: PhotographerProfileRow;
};

const FALLBACK_AVATAR = 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=300&q=80';
const PHOTOGRAPHER_SELECT = `
  id,
  rating,
  location,
  latitude,
  longitude,
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
  const profile = row.profiles;
  const fallbackLocation = profile?.city ? `${profile.city}, South Africa` : 'South Africa';
  return {
    id: row.id,
    full_name: profile?.full_name ?? 'New photographer',
    avatar_url: profile?.avatar_url ?? FALLBACK_AVATAR,
    rating: typeof row.rating === 'number' ? row.rating : 0,
    location: row.location ?? fallbackLocation,
    latitude: row.latitude,
    longitude: row.longitude,
    style: row.style,
    bio: row.bio,
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
          });
        }
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          const profile = await fetchProfile(data.user.id);
          const hydratedUser = mapSupabaseUser(data.user, 'client', profile);
          setState((prev) => ({ ...prev, currentUser: hydratedUser }));
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
  }, [ensureFreshStorage, fetchPhotographers, fetchProfile]);

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
        setState({ ...initialState, ...parsed, currentUser: normalizeStoredUser(parsed.currentUser) });
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

  const createBooking = useCallback(
    async (payload: CreateBookingInput) => {
      const booking: Booking = {
        id: uid('booking'),
        photographerId: payload.photographerId,
        date: payload.date,
        package: payload.package,
        notes: payload.notes,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      setState((prev) => ({ ...prev, bookings: [booking, ...prev.bookings] }));
      return booking;
    },
    []
  );

  const updateBookingStatus = useCallback(async (bookingId: string) => {
    const nextStatus = (current: BookingStatus): BookingStatus => {
      const order: BookingStatus[] = ['pending', 'accepted', 'completed', 'reviewed'];
      const index = order.indexOf(current);
      return order[Math.min(index + 1, order.length - 1)];
    };

    let updatedBooking: Booking | undefined;
    setState((prev) => {
      const bookings = prev.bookings.map((booking) => {
        if (booking.id !== bookingId) return booking;
        const status = nextStatus(booking.status);
        updatedBooking = { ...booking, status };
        return updatedBooking;
      });
      return { ...prev, bookings };
    });
    return updatedBooking;
  }, []);

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
          senderId: data?.sender_id ?? senderId,
          fromUser,
          text: data?.body ?? trimmed,
          timestamp: data?.created_at ?? new Date().toISOString(),
        };

        setState((prev) => ({ ...prev, messages: [...prev.messages, message] }));
        return message;
      } catch (err: any) {
        logError('send_message', err);
        const friendly = formatErrorMessage(err, 'Unable to send your message right now.');
        setError(friendly);
        throw new Error(friendly);
      }
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
        const { data, error: insertError } = await supabase
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
        return post;
      } catch (err: any) {
        logError('add_post', err);
        const message = formatErrorMessage(err, 'Unable to publish your post right now.');
        setError(message);
        throw err;
      }
    },
    [state.currentUser?.id]
  );

  const toggleLike = useCallback(async (postId: string) => {
    let updated: Post | undefined;
    setState((prev) => {
      const posts = prev.posts.map((post) => {
        if (post.id !== postId) return post;
        const liked = !post.liked;
        updated = {
          ...post,
          liked,
          likes: liked ? post.likes + 1 : Math.max(0, post.likes - 1),
        };
        return updated;
      });
      return { ...prev, posts };
    });
    return updated;
  }, []);

  const addComment = useCallback(async (postId: string, text: string, userId = 'you') => {
    const comment: Comment = {
      id: uid('comment'),
      postId,
      userId,
      text,
      createdAt: new Date().toISOString(),
    };
    setState((prev) => {
      const comments = [...prev.comments, comment];
      const posts = prev.posts.map((post) =>
        post.id === postId ? { ...post, commentCount: post.commentCount + 1 } : post
      );
      return { ...prev, comments, posts };
    });
    return comment;
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

  const requestDataDeletion = useCallback(async () => {
    const timestamp = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      privacy: { ...prev.privacy, dataDeletionRequestedAt: timestamp },
    }));
  }, []);

  const value = useMemo<AppDataContextValue>(
    () => ({
      state,
      loading,
      saving,
      authenticating,
      error,
      currentUser: state.currentUser,
      refresh,
      createBooking,
      updateBookingStatus,
      sendMessage,
      addPost,
      toggleLike,
      addComment,
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
      createBooking,
      updateBookingStatus,
      sendMessage,
      addPost,
      toggleLike,
      addComment,
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
