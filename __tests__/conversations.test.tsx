import React from 'react';

jest.mock('../src/config/supabaseClient', () => ({
  hasSupabase: false,
  supabase: {},
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: any) => cb(),
}));

jest.mock('../src/store/AppDataContext', () => ({
  useAppData: () => ({
    state: {
      currentUser: { id: 'me', email: 'me@example.com', role: 'client' },
      photographers: [
        {
          id: 'other',
          name: 'Other Name',
          style: 'Style',
          location: 'City',
          latitude: 0,
          longitude: 0,
          avatar_url: 'https://example.com/other.png', // FIX: was 'avatar', must be 'avatar_url'
          bio: '',
          rating: 4.5,
          priceRange: '$$',
          tags: [],
        },
      ],
      conversations: [
        { id: 'c1', title: 'Conversation', lastMessageAt: new Date().toISOString(), participants: ['me', 'other'] },
      ],
      bookings: [],
      messages: [],
      posts: [],
      comments: [],
      privacy: { marketingOptIn: false, personalizedAds: false, dataDeletionRequestedAt: null, locationEnabled: false },
    },
    startConversationWithUser: jest.fn(),
  }),
}));

import { getConversationDisplayInfo } from '../src/utils/conversations';
import { useAppData } from '../src/store/AppDataContext';

describe('ConversationsListScreen (local fallback)', () => {
  it('derives title and avatar from appState for 1:1 conversations', () => {
    const appState = (useAppData() as any).state;
    const conv = {
      id: 'c1',
      title: 'Conversation',
      participants: ['me', 'other'],
      lastMessageAt: new Date().toISOString(),
    } as any;
    const info = getConversationDisplayInfo(conv, appState);
    expect(info.displayTitle).toBe('Other Name');
    expect(info.avatarUrl).toBe('https://example.com/other.png');
  });
});
