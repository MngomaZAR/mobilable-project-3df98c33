import { initialState } from '../src/data/initialData';
import { clearedSessionState } from '../src/store/sessionState';

test('clears account data on session loss while retaining public content without account-specific likes', () => {
  const state = {
    ...initialState,
    currentUser: { ...initialState.currentUser, id: 'user-a' } as any,
    bookings: [{ id: 'booking-a' }] as any,
    conversations: [{ id: 'conversation-a' }] as any,
    messages: { 'conversation-a': [{ id: 'message-a' }] } as any,
    comments: { 'post-a': [{ id: 'comment-a' }] } as any,
    payments: [{ id: 'payment-a' }] as any,
    subscriptions: [{ id: 'subscription-a' }] as any,
    tips: [{ id: 'tip-a' }] as any,
    earnings: [{ id: 'earning-a' }] as any,
    mediaAssets: [{ id: 'asset-a' }] as any,
    creditsWallet: { user_id: 'user-a', balance: 100 } as any,
    creditsLedger: [{ id: 'ledger-a' }] as any,
    follows: [{ follower_id: 'user-a', following_id: 'creator' }] as any,
    notifications: [{ id: 'notification-a' }] as any,
    posts: [{ id: 'post-a', liked: true }] as any,
  };

  const cleared = clearedSessionState(state);

  expect(cleared).toMatchObject({
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
    posts: [{ id: 'post-a', liked: false }],
  });
});
