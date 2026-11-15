import { AppState } from '../types';

export const initialState: AppState = {
  loading: false,
  saving: false,
  authenticating: false,
  error: null,
  currentUser: null,
  privacy: {
    marketingOptIn: false,
    personalizedAds: false,
    dataDeletionRequestedAt: null,
    locationEnabled: false,
  },
  // Discovery must come from the server. Fictional people and ratings are not
  // a valid offline fallback for a public marketplace.
  photographers: [],
  models: [],
  bookings: [],
  conversations: [],
  profiles: [],
  messages: {},
  posts: [],
  comments: {},
  reviews: {},
  payments: [],
  subscriptions: [],
  tips: [],
  earnings: [],
  mediaAssets: [],
  creditsWallet: null,
  creditsLedger: [],
  follows: [],
  notifications: [],
};
