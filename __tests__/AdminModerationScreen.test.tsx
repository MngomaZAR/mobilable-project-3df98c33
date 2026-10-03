import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AdminModerationScreen, { normalizeContentQueue } from '../src/screens/AdminModerationScreen';
import AdminDashboardScreen from '../src/screens/AdminDashboardScreen';
import { useAppData } from '../src/store/AppDataContext';
import { apiClient } from '../src/config/apiClient';
import { getApiAccessToken } from '../src/config/apiSession';

jest.mock('../src/store/AppDataContext', () => ({ useAppData: jest.fn() }));
jest.mock('../src/store/MessagingContext', () => ({ useMessaging: () => ({ startConversationWithUser: jest.fn() }) }));
jest.mock('../src/store/ThemeContext', () => ({ useTheme: () => ({ colors: { bg: '#fff', card: '#fff', border: '#ccc', text: '#111', textMuted: '#666', textSecondary: '#444', accent: '#168', destructive: '#b00' } }) }));
jest.mock('../src/config/environment', () => ({ environment: { backendProvider: 'api' } }));
jest.mock('../src/config/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/config/apiSession', () => ({ getApiAccessToken: jest.fn() }));
jest.mock('../src/config/backendFunctions', () => ({ invokeBackendFunction: jest.fn(async () => ({ data: { verifications: [], payout_methods: [], kyc_documents: [] }, error: null })) }));
jest.mock('../src/services/backendGateway', () => ({
  backendDb: { from: () => {
    const query = { select: () => query, order: () => query, in: () => query, limit: async () => ({ data: [], error: null }), then: (resolve: any) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve) };
    return query;
  } },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (effect: any) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../src/components/NewMessageModal', () => ({ NewMessageModal: () => null }));

const item = { id: 'pending-post', caption: 'Needs content review', author_id: 'creator', moderation_status: 'pending', created_at: '2026-10-03T10:00:00Z' };
const queue = () => ({ content: { posts: [item], stories: [], post_comments: [], reviews: [] }, counts: { posts: 1, stories: 0, post_comments: 0, reviews: 0 } });
const adminContext = () => ({ state: { currentUser: { id: 'admin', role: 'admin' }, bookings: [], profiles: [] }, fetchBookings: jest.fn(async () => undefined) });

describe('Admin moderation UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAppData as jest.Mock).mockReturnValue(adminContext());
    (getApiAccessToken as jest.Mock).mockResolvedValue('test-admin-token');
    (apiClient.get as jest.Mock).mockResolvedValue(queue());
    (apiClient.post as jest.Mock).mockImplementation(async (_path, payload) => ({ id: payload.id, table: payload.table, moderation_status: payload.decision, audit_event_id: 'event' }));
  });

  it('uses correct schema names when flattening content arrays', () => {
    const response = queue();
    (response.content.post_comments as any[]).push({ ...item, id: 'comment', body: 'Comment body' });
    response.counts.post_comments = 1;
    expect(normalizeContentQueue(response).map(row => row.table)).toEqual(['posts', 'post_comments']);
    expect(() => normalizeContentQueue({ ...response, counts: {} } as any)).toThrow();
    expect(() => normalizeContentQueue({ ...response, content: { ...response.content, posts: [null] } } as any)).toThrow();
  });

  it('does not load administrator data for another role', () => {
    (useAppData as jest.Mock).mockReturnValue({ state: { currentUser: { id: 'client', role: 'client' } } });
    const view = render(<AdminModerationScreen />);
    expect(view.getByText('Administrator access required.')).toBeTruthy();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it.each(['stories', 'post_comments', 'reviews'])('renders and submits the correct %s queue item', async table => {
    const response = queue();
    response.content.posts = [];
    response.counts.posts = 0;
    (response.content as any)[table] = [{ ...item, id: 'other-content', caption: null, body: 'Comment evidence', comment: 'Review evidence', rating: 4 }];
    (response.counts as any)[table] = 1;
    (apiClient.get as jest.Mock).mockResolvedValue(response);
    const view = render(<AdminModerationScreen />);
    const label = { stories: 'story', post_comments: 'comment', reviews: 'review' }[table];
    fireEvent.press(await view.findByRole('button', { name: `Review ${label} other-content` }));
    fireEvent.changeText(view.getByLabelText('Decision reason'), 'Policy evidence');
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Reject content' })); });
    expect(apiClient.post).toHaveBeenCalledWith('/admin/moderation/content/review', expect.objectContaining({ table, id: 'other-content', decision: 'rejected' }), { token: 'test-admin-token' });
  });

  it('does not request administrator data without a session token', async () => {
    (getApiAccessToken as jest.Mock).mockResolvedValue(null);
    const view = render(<AdminModerationScreen />);
    expect(await view.findByText('Sign in again to load the moderation queue.')).toBeTruthy();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('loads the real queue and requires a reason before either decision', async () => {
    const view = render(<AdminModerationScreen />);
    fireEvent.press(await view.findByRole('button', { name: 'Review post pending-post' }));
    fireEvent.press(view.getByRole('button', { name: 'Approve content' }));
    expect(view.getByText('Enter a reason of 3 to 1000 characters.')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Reject content' }));
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(apiClient.get).toHaveBeenCalledWith('/admin/moderation/content', { token: 'test-admin-token' });
  });

  it.each(['approved', 'rejected'])('confirms and refreshes an audited %s decision', async decision => {
    const view = render(<AdminModerationScreen />);
    fireEvent.press(await view.findByRole('button', { name: 'Review post pending-post' }));
    fireEvent.changeText(view.getByLabelText('Decision reason'), '  Reviewed policy evidence  ');
    (apiClient.get as jest.Mock).mockResolvedValue({ ...queue(), content: { ...queue().content, posts: [] }, counts: { ...queue().counts, posts: 0 } });
    await act(async () => { fireEvent.press(view.getByRole('button', { name: decision === 'approved' ? 'Approve content' : 'Reject content' })); });
    expect(apiClient.post).toHaveBeenCalledWith('/admin/moderation/content/review', { table: 'posts', id: item.id, decision, reason: 'Reviewed policy evidence', expected_status: 'pending' }, { token: 'test-admin-token' });
    expect(await view.findByText('No pending content')).toBeTruthy();
  });

  it('keeps failed content and its reason visible, without claiming success', async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(new Error('Parent post is not approved.'));
    const view = render(<AdminModerationScreen />);
    fireEvent.press(await view.findByRole('button', { name: 'Review post pending-post' }));
    fireEvent.changeText(view.getByLabelText('Decision reason'), 'Needs review');
    fireEvent.press(view.getByRole('button', { name: 'Approve content' }));
    expect(await view.findByText('Parent post is not approved.')).toBeTruthy();
    expect(view.getByLabelText('Decision reason').props.value).toBe('Needs review');
    expect(view.queryByText('No pending content')).toBeNull();
  });

  it('guards immediate double submission before React can rerender', async () => {
    let finish!: (result: unknown) => void;
    (apiClient.post as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<AdminModerationScreen />);
    fireEvent.press(await view.findByRole('button', { name: 'Review post pending-post' }));
    fireEvent.changeText(view.getByLabelText('Decision reason'), 'Needs review');
    const button = view.getByRole('button', { name: 'Reject content' });
    fireEvent.press(button);
    fireEvent.press(button);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(view.getByRole('button', { name: 'Close content decision' })).toBeDisabled();
    await act(async () => { finish({ id: item.id, table: 'posts', moderation_status: 'rejected', audit_event_id: 'event' }); });
  });

  it('does not accept a response missing its audit acknowledgement', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ id: item.id, table: 'posts', moderation_status: 'approved' });
    const view = render(<AdminModerationScreen />);
    fireEvent.press(await view.findByRole('button', { name: 'Review post pending-post' }));
    fireEvent.changeText(view.getByLabelText('Decision reason'), 'Needs review');
    fireEvent.press(view.getByRole('button', { name: 'Approve content' }));
    expect(await view.findByText('The decision could not be confirmed. Refresh the queue.')).toBeTruthy();
  });

  it('shows queue failure and retries rather than falsely showing an empty queue', async () => {
    (apiClient.get as jest.Mock).mockRejectedValueOnce(new Error('Queue unavailable.'));
    const view = render(<AdminModerationScreen />);
    expect(await view.findByText('Queue unavailable.')).toBeTruthy();
    expect(view.queryByText('No pending content')).toBeNull();
    fireEvent.press(view.getByRole('button', { name: 'Refresh moderation queue' }));
    expect(await view.findByRole('button', { name: 'Review post pending-post' })).toBeTruthy();
  });

  it('uses real pending content counts on the dashboard', async () => {
    const view = render(<AdminDashboardScreen />);
    await waitFor(() => expect(view.getByTestId('admin-pending-content-count').props.children).toBe(1));
  });
});
