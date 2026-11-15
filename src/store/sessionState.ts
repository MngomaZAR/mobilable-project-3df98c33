import { AppState } from '../types';
import { initialState } from '../data/initialData';

export const clearedSessionState = (state: AppState): Partial<AppState> => ({
  currentUser: null,
  bookings: [],
  conversations: [],
  messages: {},
  comments: {},
  payments: [],
  subscriptions: [],
  tips: [],
  earnings: [],
  mediaAssets: [],
  creditsWallet: null,
  creditsLedger: [],
  follows: [],
  notifications: [],
  privacy: initialState.privacy,
  posts: state.posts.map(post => ({ ...post, liked: false })),
});
