import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialState } from '../data/initialData';
import { supabase } from '../config/supabaseClient';
import { AppState, AppUser, Booking, BookingStatus, Comment, Message, Post, PrivacySettings } from '../types';
import { uid } from '../utils/id';

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
  createBooking: (payload: CreateBookingInput) => Promise<Booking>;
  updateBookingStatus: (bookingId: string) => Promise<Booking | undefined>;
  sendMessage: (conversationId: string, text: string, fromUser?: boolean) => Promise<Message>;
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

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed: AppState = JSON.parse(stored);
          setState({
            ...initialState,
            ...parsed,
          });
        }
      } catch (err) {
        console.warn('Failed to load state', err);
        setError('Unable to load saved data.');
      } finally {
        setHydrated(true);
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const persist = async () => {
      setSaving(true);
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
        setState({ ...initialState, ...parsed });
      } else {
        setState(initialState);
      }
    } catch (err) {
      console.warn('Refresh failed', err);
      setError('Unable to refresh data.');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const sendMessage = useCallback(async (conversationId: string, text: string, fromUser = true) => {
    const message: Message = {
      id: uid('msg'),
      conversationId,
      fromUser,
      text,
      timestamp: new Date().toISOString(),
    };
    setState((prev) => ({ ...prev, messages: [...prev.messages, message] }));
    return message;
  }, []);

  const addPost = useCallback(async ({ caption, imageUri, location, userId = 'you' }: CreatePostInput) => {
    const post: Post = {
      id: uid('post'),
      userId,
      caption,
      imageUri,
      createdAt: new Date().toISOString(),
      likes: 0,
      liked: false,
      commentCount: 0,
      location,
    };
    setState((prev) => ({ ...prev, posts: [post, ...prev.posts] }));
    return post;
  }, []);

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
      setState(initialState);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
    } catch (err) {
      console.warn('Failed to reset state', err);
      setError('Unable to reset data.');
    }
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, role: AppUser['role'] = 'client') => {
      setAuthenticating(true);
      setError(null);
      try {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { role },
          },
        });
        if (signUpError) {
          setError(signUpError.message);
          return null;
        }
        const user: AppUser | null = data.user
          ? {
              id: data.user.id,
              email: data.user.email ?? email,
              role: ((data.user.user_metadata as any)?.role as AppUser['role']) ?? role,
            }
          : null;
        setState((prev) => ({ ...prev, currentUser: user }));
        return user;
      } catch (err: any) {
        setError(err.message ?? 'Unable to sign up.');
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
      const user: AppUser | null = data.user
        ? {
            id: data.user.id,
            email: data.user.email ?? email,
            role: ((data.user.user_metadata as any)?.role as AppUser['role']) ?? 'client',
          }
        : null;
      setState((prev) => ({ ...prev, currentUser: user }));
      return user;
    } catch (err: any) {
      setError(err.message ?? 'Unable to sign in.');
      return null;
    } finally {
      setAuthenticating(false);
    }
  }, []);

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
