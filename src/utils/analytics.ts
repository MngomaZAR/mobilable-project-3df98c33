/**
 * Self-hosted analytics — stores events in Supabase `analytics_events` table.
 * No external accounts, no API keys, no rate limits beyond Supabase free tier.
 */
import { supabase } from '../config/supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const APP_VERSION = '1.0.0';
const SESSION_KEY = 'papzi_session_id';

let _sessionId: string | null = null;
let _userId: string | null = null;
let _eventQueue: any[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

const getSessionId = async (): Promise<string> => {
  if (_sessionId) return _sessionId;
  let stored = await AsyncStorage.getItem(SESSION_KEY);
  if (!stored) {
    stored = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await AsyncStorage.setItem(SESSION_KEY, stored);
  }
  _sessionId = stored;
  return stored;
};

export const identify = (userId: string) => {
  _userId = userId;
};

export const resetIdentity = () => {
  _userId = null;
  _sessionId = null;
  AsyncStorage.removeItem(SESSION_KEY);
};

const flush = async () => {
  if (_eventQueue.length === 0) return;
  const batch = [..._eventQueue];
  _eventQueue = [];
  try {
    await supabase.from('analytics_events').insert(batch);
  } catch {
    // silent — analytics must never crash the app
  }
};

const scheduledFlush = () => {
  if (_flushTimer) return;
  _flushTimer = setTimeout(async () => {
    _flushTimer = null;
    await flush();
  }, 2000); // batch events every 2 seconds
};

export const track = async (
  eventName: string,
  properties: Record<string, any> = {},
  screen?: string,
) => {
  const sessionId = await getSessionId();
  _eventQueue.push({
    user_id: _userId ?? null,
    session_id: sessionId,
    event_name: eventName,
    screen: screen ?? null,
    properties,
    platform: Platform.OS,
    app_version: APP_VERSION,
    created_at: new Date().toISOString(),
  });
  scheduledFlush();
};

export const page = (screenName: string, props: Record<string, any> = {}) => {
  track('screen_view', props, screenName);
};

// Common event helpers
export const Analytics = {
  login: (method: 'email' | 'google' | 'apple') => track('login', { method }),
  signUp: (role: string) => track('sign_up', { role }),
  bookingCreated: (packageType: string, amount: number) => track('booking_created', { packageType, amount }),
  bookingAccepted: (bookingId: string) => track('booking_accepted', { bookingId }),
  bookingCompleted: (bookingId: string, amount: number) => track('booking_completed', { bookingId, amount }),
  messageSent: (chatId: string, hasMedia: boolean) => track('message_sent', { chatId, hasMedia }),
  postCreated: (mediaType: string) => track('post_created', { mediaType }),
  postLiked: (postId: string) => track('post_liked', { postId }),
  postBookmarked: (postId: string) => track('post_bookmarked', { postId }),
  talentViewed: (talentId: string, role: string) => track('talent_viewed', { talentId, role }),
  mapOpened: () => track('map_opened'),
  searchPerformed: (query: string, resultCount: number) => track('search', { query, resultCount }),
  tipSent: (amount: number) => track('tip_sent', { amount }),
  subscriptionCreated: (tierId: string) => track('subscription_created', { tierId }),
  videoCallStarted: (role: 'creator' | 'viewer') => track('video_call_started', { role }),
  storyViewed: (storyId: string) => track('story_viewed', { storyId }),
  storyCreated: () => track('story_created'),
  ppvUnlocked: (price: number) => track('ppv_unlocked', { price }),
};
