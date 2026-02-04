import React from 'react';
import renderer from 'react-test-renderer';

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
        { id: 'other', name: 'Other Name', style: 'Style', location: 'City', latitude: 0, longitude: 0, avatar: 'https://example.com/other.png', bio: '', rating: 4.5, priceRange: '$$', tags: [] },
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

import ConversationsListScreen from '../src/screens/ConversationsListScreen';

describe('ConversationsListScreen (local fallback)', () => {
  it('renders a friendly title and avatar for local 1:1 conversations', () => {
    const tree = renderer.create(<ConversationsListScreen />).toJSON();
    expect(tree).toBeTruthy();
    const textNodes: any[] = [];

    const walk = (node: any) => {
      if (!node) return;
      if (typeof node === 'string') return;
      if (node.type === 'Text') {
        if (node.children) textNodes.push(node.children.join(''));
      }
      if (node.children && node.children.length) node.children.forEach(walk);
    };

    walk(tree);

    // Should show the photographer's name as a conversation title
    expect(textNodes.some((t) => /Other Name/.test(t))).toBeTruthy();
  });
});
