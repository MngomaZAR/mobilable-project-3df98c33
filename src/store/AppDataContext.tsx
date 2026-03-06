
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialState } from '../data/initialData';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { AppState, AppUser, Booking, BookingStatus, Comment, ConversationSummary, Message, Post, PrivacySettings } from '../types';
import { uid } from '../utils/id';
import { formatAuthError, formatErrorMessage, logError } from '../utils/errors';
import { mapPhotographerRow, mapSupabaseUser } from '../utils/mappings';
import { startConversationViaEdge } from '../services/chatService';

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
  fetchMessages: (chatId: string) => Promise<void>;
  fetchMessagesForChat: (chatId: string) => Promise<void>;
  startConversationWithUser: (participantId: string, title?: string) => Promise<{ id: string; title: string }>;
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

const STORAGE_KEY = 'movable-app-state-v2';
const MAX_PHOTOGRAPHERS = 120;
const BOOKING_SELECT = 'id, photographer_id, booking_date, package_type, notes, status, created_at';

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

type ProfileRow = { role?: AppUser['role']; verified?: boolean } | null;
type BookingRow = {
  id: string;
  photographer_id: string;
  booking_date: string | null;
  package_type: string | null;
  notes: string | null;
  status: BookingStatus | null;
  created_at: string | null;
};

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

const mapBookingRow = (row: BookingRow): Booking => ({
  id: row.id,
  photographerId: row.photographer_id,
  date: row.booking_date ?? '',
  package: row.package_type ?? 'Photography booking',
  notes: row.notes ?? '',
  status: (row.status ?? 'pending') as BookingStatus,
  createdAt: row.created_at ?? new Date().toISOString(),
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
    case 'SET_STATE':
      return { ...state, ...action.payload };
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

  const setState = (payload: Partial<AppState>) => dispatch({ type: 'SET_STATE', payload });
  const setLoading = (payload: boolean) => dispatch({ type: 'SET_LOADING', payload });
  const setSaving = (payload: boolean) => dispatch({ type: 'SET_SAVING', payload });
  const setAuthenticating = (payload: boolean) => dispatch({ type: 'SET_AUTHENTICATING', payload });
  const setError = (payload: string | null) => dispatch({ type: 'SET_ERROR', payload });

  const fetchProfile = useCallback(async (userId: string): Promise<ProfileRow> => {
    if (!hasSupabase) return null;
    try {
      const { data } = await supabase.from('profiles').select('role, verified').eq('id', userId).maybeSingle();
      return data ?? null;
    } catch (err) {
      logError('fetchProfile', err);
      return null;
    }
  }, []);

  const fetchPhotographers = useCallback(async () => {
    if (!hasSupabase) return;
    try {
      const { data, error: photographerError } = await supabase
        .from('photographers')
        .select(PHOTOGRAPHER_SELECT)
        .limit(MAX_PHOTOGRAPHERS)
        .order('rating', { ascending: false });
      if (photographerError) throw photographerError;
      const photographers = (data ?? []).map(mapPhotographerRow).slice(0, MAX_PHOTOGRAPHERS);
      setState({ photographers });
    } catch (err: any) {
      const message = formatErrorMessage(err, 'Unable to load photographers right now.');
      // Do not spam device overlays for common connectivity errors in development.
      if (!/failed to fetch|network/i.test(message)) {
        logError('fetch_photographers', err);
      }
      setError(message);
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
        const { data, error } = await supabase
          .from('bookings')
          .select(BOOKING_SELECT)
          .or(`client_id.eq.${targetUserId},photographer_id.eq.${targetUserId}`)
          .order('created_at', { ascending: false })
          .limit(80);

        if (error) throw error;
        const bookings = (data ?? []).map((row) => mapBookingRow(row as BookingRow));
        setState({ bookings });
      } catch (err) {
        logError('fetch_bookings', err);
        setError(formatErrorMessage(err, 'Unable to load bookings right now.'));
      }
    },
    []
  );

  
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
          const { data } = await supabase.auth.getUser();
          if (data.user) {
            const profile = await fetchProfile(data.user.id);
            setState({ currentUser: mapSupabaseUser(data.user, 'client', profile) });
            await fetchBookings(data.user.id);
          } else {
            setState({ bookings: [] });
          }
          await fetchPhotographers();
        }
      } catch (err) {
        logError('load_state', err);
        setError('Unable to load saved data.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [fetchBookings, fetchPhotographers, fetchProfile]);

  useEffect(() => {
    if (!hasSupabase) return;
    const { data } = supabase.auth.onAuthStateChange(async (_, session) => {
      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        setState({ currentUser: mapSupabaseUser(session.user, state.currentUser?.role ?? 'client', profile)});
        await fetchBookings(session.user.id);
      } else {
        setState({ currentUser: null, bookings: [], conversations: [], messages: [] });
      }
    });

    return () => {
      data.subscription?.unsubscribe();
    };
  }, [fetchBookings, fetchProfile, state.currentUser?.role]);

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
    persist();
  }, [state]);

    const createBooking = useCallback(
    async (payload: CreateBookingInput) => {
      if (!state.currentUser) {
        throw new Error('You must be logged in to create a booking.');
      }
      const booking: Booking = {
        id: uid('booking'),
        photographerId: payload.photographerId,
        date: payload.date,
        package: payload.package,
        notes: payload.notes,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      let persistedBooking = booking;

      if (hasSupabase) {
        const bookingDate = payload.date.split('|')[0]?.trim().slice(0, 10);
        const { data, error } = await supabase
          .from('bookings')
          .insert([
            {
              client_id: state.currentUser.id,
              photographer_id: booking.photographerId,
              booking_date: bookingDate || null,
              package_type: booking.package,
              notes: booking.notes,
              status: booking.status,
            },
          ])
          .select('id, photographer_id, booking_date, package_type, notes, status, created_at')
          .single();

        if (error) {
          logError('createBooking', error);
          setError(formatErrorMessage(error, 'Unable to create booking.'));
          throw error;
        }

        persistedBooking = {
          id: data?.id ?? booking.id,
          photographerId: data?.photographer_id ?? booking.photographerId,
          date: data?.booking_date ? new Date(data.booking_date).toISOString() : booking.date,
          package: data?.package_type ?? booking.package,
          notes: data?.notes ?? booking.notes,
          status: (data?.status as BookingStatus) ?? booking.status,
          createdAt: data?.created_at ?? booking.createdAt,
        };
      }

      setState({ bookings: [persistedBooking, ...state.bookings] });
      return persistedBooking;
    },
    [state.currentUser, state.bookings]
  );

    const updateBookingStatus = useCallback(async (bookingId: string) => {
    const nextStatus = (current: BookingStatus): BookingStatus => {
      const order: BookingStatus[] = ['pending', 'accepted', 'completed'];
      const index = order.indexOf(current);
      if (index < 0) return current;
      return order[Math.min(index + 1, order.length - 1)];
    };

    const booking = state.bookings.find(b => b.id === bookingId);
    if (!booking) {
        logError('updateBookingStatus', new Error('Booking not found'));
        return;
    }

    const newStatus = nextStatus(booking.status);
    let updatedBooking: Booking | undefined;

    // Optimistic update
    const bookings = state.bookings.map((b) => {
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
                setState({ bookings: state.bookings });
                logError('updateBookingStatus', error);
                setError(formatErrorMessage(error, 'Unable to update booking status.'));
                throw error;
            }
        } catch(err) {
             // Revert optimistic update
             setState({ bookings: state.bookings });
             logError('updateBookingStatus', err);
             setError(formatErrorMessage(err, 'Unable to update booking status.'));
             throw err;
        }
    }

    return updatedBooking;
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

      const message: Message = {
        id: uid('msg'),
        chatId,
        fromUser,
        text: trimmed,
        timestamp: new Date().toISOString(),
      };

      // Optimistic update
      const previousMessages = stateRef.current.messages;
      const optimisticMessages = [...previousMessages, message];
      setState({ messages: optimisticMessages });

      if (hasSupabase) {
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

            const newMessage = {
                id: data?.id ?? message.id,
                chatId: data?.chat_id ?? chatId,
                fromUser,
                text: data?.body ?? trimmed,
                timestamp: data?.created_at ?? new Date().toISOString(),
            };

            // Replace optimistic message with the real one
            const latestMessages = stateRef.current.messages;
            const hasOptimistic = latestMessages.some((m) => m.id === message.id);
            const nextMessages = hasOptimistic
              ? latestMessages.map((m) => (m.id === message.id ? newMessage : m))
              : [...latestMessages, newMessage];
            setState({ messages: nextMessages });
            return newMessage;

        } catch (err: any) {
            // Revert optimistic update
            setState({ messages: stateRef.current.messages.filter((m) => m.id !== message.id) });
            logError('send_message', err);
            const friendly = formatErrorMessage(err, 'Unable to send your message right now.');
            setError(friendly);
            throw new Error(friendly);
        }
      }

      return message;
    },
    [state.currentUser?.id]
  );

  const fetchMessages = useCallback(async (chatId: string) => {
    if (!hasSupabase) return;
    try {
      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('id, chat_id, sender_id, body, created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;

      const mapped: Message[] = (data ?? []).map((row: any) => ({
        id: row.id,
        chatId: row.chat_id,
        fromUser: row.sender_id === state.currentUser?.id,
        text: row.body,
        timestamp: row.created_at ?? new Date().toISOString(),
      }));

      // Replace messages for this chat in local state but keep others
      const latestMessages = stateRef.current.messages;
      setState({ messages: [...latestMessages.filter((m) => m.chatId !== chatId), ...mapped]});
    } catch (err) {
      logError('fetch_messages', err);
      setError('Unable to load messages for this chat.');
    }
  }, [state.currentUser?.id]);

  const fetchMessagesForChat = useCallback(async (chatId: string) => {
    // backwards compatible alias
    return fetchMessages(chatId);
  }, [fetchMessages]);

  const startConversationWithUser = useCallback(async (participantId: string, title?: string) => {
    const currentUserId = state.currentUser?.id;
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
    const existingConversation = state.conversations.find((c) => c.participants?.includes(participantId));
    if (existingConversation) {
        return { id: existingConversation.id, title: existingConversation.title };
    }

    const convoTitle = title ?? `Chat with ${participantId}`;

    const convo: ConversationSummary = {
        id: uid('conv'),
        title: convoTitle,
        participants: [currentUserId, participantId],
        lastMessage: 'Say hello 👋',
        lastMessageAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
    };

    // Optimistic update
    setState({ conversations: [convo, ...state.conversations] });


    if (hasSupabase) {
      try {
        const data = await startConversationViaEdge({ participantId, title: convoTitle });
        const newConvo: ConversationSummary = {
          ...convo,
          id: data.id,
          title: data.title,
        };
        setState({ conversations: [newConvo, ...state.conversations.filter((c) => c.id !== convo.id)] });
        return { id: newConvo.id, title: newConvo.title };
      } catch (err: any) {
        // Revert optimistic update
        setState({ conversations: state.conversations.filter((c) => c.id !== convo.id) });
        logError('start_conversation', err);
        const friendly = formatErrorMessage(err, 'Unable to start a chat right now.');
        setError(friendly);
        throw new Error(friendly);
      }
    }

    return { id: convo.id, title: convo.title };
  }, [state.currentUser?.id, state.conversations]);

  const addPost = useCallback(
    async ({ caption, imageUri, location, userId }: CreatePostInput) => {
      const ownerId = userId ?? state.currentUser?.id;
      if (!ownerId) {
        const message = 'You need an account to publish a post.';
        setError(message);
        throw new Error(message);
      }

        const post: Post = {
            id: uid('post'),
            userId: ownerId,
            caption,
            imageUri,
            createdAt: new Date().toISOString(),
            likes: 0,
            liked: false,
            commentCount: 0,
            location,
        };

        // Optimistic update
        setState({ posts: [post, ...state.posts] });

        if (hasSupabase) {
            try {
                const { data, error: insertError } = await supabase
                .from('posts')
                .insert({
                    user_id: ownerId,
                    caption,
                    location,
                    image_url: imageUri,
                })
                .select('id, user_id, caption, location, comment_count, created_at, image_url, likes_count')
                .single();

                if (insertError) {
                    throw insertError;
                }

                const newPost = {
                    ...post,
                    id: data?.id ?? post.id,
                    likes: data?.likes_count ?? 0,
                    commentCount: data?.comment_count ?? 0,
                    createdAt: data?.created_at ?? new Date().toISOString(),
                };

                // Replace optimistic post with the real one
                setState({ posts: state.posts.map(p => p.id === post.id ? newPost : p) });
                return newPost;

            } catch (err: any) {
                // Revert optimistic update
                setState({ posts: state.posts.filter(p => p.id !== post.id) });
                logError('add_post', err);
                const message = formatErrorMessage(err, 'Unable to publish your post right now.');
                setError(message);
                throw err;
            }
        }

      return post;
    },
    [state.currentUser?.id, state.posts]
  );

  const toggleLike = useCallback(async (postId: string) => {
    const userId = state.currentUser?.id;
    if (!userId) {
      const msg = 'You need to be signed in to like posts.';
      setError(msg);
      throw new Error(msg);
    }

    // Optimistic update locally
    let optimistic: Post | undefined;
    const posts = state.posts.map((post) => {
        if (post.id !== postId) return post;
        const liked = !post.liked;
        optimistic = { ...post, liked, likes: liked ? post.likes + 1 : Math.max(0, post.likes - 1) };
        return optimistic;
    });
    setState({ posts });

    if (hasSupabase) {
        try {
            // Check if like exists
            const { data: existingLike, error: selErr } = await supabase
                .from('post_likes')
                .select('id')
                .eq('post_id', postId)
                .eq('user_id', userId)
                .maybeSingle();

            if (selErr) throw selErr;

            if (existingLike && existingLike.id) {
                const { error: delErr } = await supabase.from('post_likes').delete().eq('id', existingLike.id);
                if (delErr) throw delErr;
            } else {
                const { error: insertErr } = await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
                if (insertErr) throw insertErr;
            }

            // Recount likes and persist to posts table to keep feed subscribers in sync
            const { data: likesRows, error: likesErr } = await supabase.from('post_likes').select('id').eq('post_id', postId);
            if (likesErr) throw likesErr;
            const likesCount = (likesRows ?? []).length;

            const { error: postUpdateErr } = await supabase.from('posts').update({ likes_count: likesCount }).eq('id', postId);
            if (postUpdateErr) throw postUpdateErr;

            // Ensure local state matches DB count
            setState({ posts: state.posts.map((p) => (p.id === postId ? { ...p, likes: likesCount } : p)) });

        } catch (err: any) {
            // Roll back optimistic toggled like
            setState({ posts: state.posts.map((post) =>
                post.id === postId
                    ? { ...post, liked: !post.liked, likes: post.liked ? Math.max(0, post.likes - 1) : post.likes + 1 }
                    : post
                ),
            });
            const message = formatErrorMessage(err, 'Unable to update like right now.');
            setError(message);
            logError('toggle_like', err);
            throw err;
        }
    }

    return optimistic;
  }, [state.currentUser?.id, state.posts]);

  const addComment = useCallback(async (postId: string, text: string, userId = 'you') => {
    const comment: Comment = {
      id: uid('comment'),
      postId,
      userId,
      text,
      createdAt: new Date().toISOString(),
    };

    // Optimistic update
    const posts = state.posts.map((post) =>
        post.id === postId ? { ...post, commentCount: post.commentCount + 1 } : post
    );
    setState({ comments: [...state.comments, comment], posts });


    if (hasSupabase) {
        try {
            const { error } = await supabase.from('post_comments').insert([{
                id: comment.id,
                post_id: postId,
                user_id: userId,
                body: text,
                created_at: comment.createdAt
            }]);
            if (error) {
                throw error;
            }
        } catch (err: any) {
            // Revert optimistic update
            const posts = state.posts.map((post) =>
                post.id === postId ? { ...post, commentCount: Math.max(0, post.commentCount - 1) } : post
            );
            setState({ comments: state.comments.filter(c => c.id !== comment.id), posts });

            logError('addComment', err);
            setError(formatErrorMessage(err, 'Unable to add comment.'));
            throw err;
        }
    }

    return comment;
  }, [state.comments, state.posts]);

  const signUp = useCallback(
    async (email: string, password: string, /* role intentionally ignored for security; only server/admin may grant roles */ _role: AppUser['role'] = 'client') => {
      setAuthenticating(true);
      setError(null);
      try {
        // Do not allow client-controlled role assignments via auth metadata
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
          // Upsert profile without allowing client to decide role. Default DB role is 'client'.
          await supabase.from('profiles').upsert({
            id: data.user.id,
            verified: false,
          });
        }
        const user: AppUser | null = data.user ? mapSupabaseUser(data.user, 'client', { role: 'client', verified: false }) : null;
        setState({ currentUser: user });
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
      setState({ currentUser: user });
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
      if (hasSupabase) {
        await supabase.auth.signOut();
      }
      setState({ currentUser: null });
    } catch (err: any) {
      setError(err.message ?? 'Unable to sign out.');
    } finally {
      setAuthenticating(false);
    }
  }, []);

  const revalidateSession = useCallback(async (): Promise<AppUser | null> => {
    if (!hasSupabase) {
      return state.currentUser;
    }

    try {
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      if (!data.user) {
        setState({ currentUser: null });
        return null;
      }

      const profile = await fetchProfile(data.user.id);
      const user = mapSupabaseUser(data.user, state.currentUser?.role ?? 'client', profile);
      setState({ currentUser: user });
      return user;
    } catch (err) {
      logError('revalidate_session', err);
      setError(formatErrorMessage(err, 'Unable to validate your current session.'));
      return null;
    }
  }, [fetchProfile, state.currentUser]);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const currentUser = await revalidateSession();
      await Promise.all([fetchPhotographers(), fetchBookings(currentUser?.id ?? null)]);
    } finally {
      setLoading(false);
    }
  }, [fetchBookings, fetchPhotographers, revalidateSession]);

  const resetState = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const currentUser = state.currentUser;
      await AsyncStorage.removeItem(STORAGE_KEY);
      setState({ ...initialState, currentUser });
    } catch (err) {
      logError('reset_state', err);
      setError('Unable to reset local data.');
    } finally {
      setSaving(false);
    }
  }, [state.currentUser]);

  const updatePrivacy = useCallback(async (changes: Partial<PrivacySettings>) => {
    const userId = state.currentUser?.id;
    if (!userId) {
      const msg = 'You need to be logged in to change your privacy settings';
      setError(msg);
      throw new Error(msg);
    }

    // Optimistic update
    const privacy = { ...state.privacy, ...changes };
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
              if (enabled) {
                const { error } = await supabase.from('user_consents').upsert(
                  {
                    user_id: userId,
                    consent_type: consentType,
                    accepted_at: new Date().toISOString(),
                  },
                  { onConflict: 'user_id,consent_type' }
                );
                if (error) throw error;
              } else {
                const { error } = await supabase
                  .from('user_consents')
                  .delete()
                  .eq('user_id', userId)
                  .eq('consent_type', consentType);
                if (error) throw error;
              }
            }
        } catch(err: any) {
            // Revert
            setState({ privacy: state.privacy });
            const msg = formatErrorMessage(err, 'Unable to update your privacy settings.');
            setError(msg);
            throw new Error(msg);
        }
    }
  }, [state.currentUser?.id, state.privacy]);

  const requestDataDeletion = useCallback(async () => {
    const userId = state.currentUser?.id;
    if (!userId) {
      const msg = 'You need to be logged in to delete your data';
      setError(msg);
      throw new Error(msg);
    }

    const previousPrivacy = state.privacy;
    const requestedAt = new Date().toISOString();
    setState({ privacy: { ...previousPrivacy, dataDeletionRequestedAt: requestedAt } });

    if (hasSupabase) {
        try {
            const { error } = await supabase.from('account_deletion_requests').insert({
              created_by: userId,
              reason: 'Requested from mobile app settings',
            });
            if (error) throw error;
        } catch(err: any) {
            setState({ privacy: previousPrivacy });
            const msg = formatErrorMessage(err, 'Unable to request data deletion.');
            setError(msg);
            throw new Error(msg);
        }
    }
  }, [state.currentUser?.id, state.privacy]);

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
      fetchMessages,
      fetchMessagesForChat,
      startConversationWithUser,
      addPost,
      toggleLike,
      addComment,
      signUp,
      signIn,
      signOut,
      updatePrivacy,
      requestDataDeletion,
      refresh,
      revalidateSession,
      resetState,
    }),
    [state, createBooking, updateBookingStatus, sendMessage, fetchMessages, fetchMessagesForChat, startConversationWithUser, addPost, toggleLike, addComment, signUp, signIn, signOut, updatePrivacy, requestDataDeletion, refresh, revalidateSession, resetState]
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
