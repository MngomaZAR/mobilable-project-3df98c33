import React from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import UserProfileScreen from '../src/screens/UserProfileScreen';
import { useAppData } from '../src/store/AppDataContext';
import { fetchCreatorPosts, fetchCreatorProfile } from '../src/services/creatorProfileService';
import { fetchPublishedReviewSummary } from '../src/services/reviewService';
import { toggleFollow } from '../src/services/followService';
import { trackEvent } from '../src/services/analyticsService';
import { reportContent } from '../src/services/reportService';

const mockNavigate = jest.fn();
const mockChat = jest.fn();
const mockSetState = jest.fn();
let mockParams = { userId: 'creator-1' };
jest.mock('../src/store/AppDataContext', () => ({ useAppData: jest.fn() }));
jest.mock('../src/services/creatorProfileService', () => ({ fetchCreatorProfile: jest.fn(), fetchCreatorPosts: jest.fn() }));
jest.mock('../src/services/reviewService', () => ({ fetchPublishedReviewSummary: jest.fn() }));
jest.mock('../src/services/followService', () => ({ toggleFollow: jest.fn() }));
jest.mock('../src/services/reportService', () => ({ reportContent: jest.fn() }));
jest.mock('../src/services/analyticsService', () => ({ trackEvent: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

const detail = () => ({ profile: { id: 'creator-1', full_name: 'Lebo Mokoena', role: 'photographer', verified: true, kyc_status: 'approved', age_verified: true, bio: 'Portraits and live events', city: 'Durban' }, talent: { id: 'creator-1', name: 'Lebo Mokoena', hourly_rate: 1200, tags: [] } });
let context: any;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockParams = { userId: 'creator-1' };
  context = { state: { currentUser: { id: 'client-1' }, photographers: [], models: [], profiles: [], posts: [], follows: [], bookings: [] }, startConversationWithUser: mockChat, setState: mockSetState };
  (useAppData as jest.Mock).mockReturnValue(context);
  (fetchCreatorProfile as jest.Mock).mockResolvedValue(detail());
  (fetchCreatorPosts as jest.Mock).mockResolvedValue([]);
  (fetchPublishedReviewSummary as jest.Mock).mockResolvedValue({ count: 0, average: null });
  mockChat.mockResolvedValue({ id: 'chat-1', title: 'Shoot chat' });
});
afterEach(async () => {
  await act(async () => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

test('uncached creator loads authoritative details without fabricated rating or review count', async () => {
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByText('No published reviews yet')).toBeTruthy());
  expect(fetchCreatorProfile).toHaveBeenCalledWith('creator-1');
  expect(screen.getByText('Durban')).toBeTruthy();
  expect(screen.queryByText(/128 reviews|5.0 Rating|Cape Town|Scene Rank|Collaboration request sent/)).toBeNull();
});

test('actual full-set published review summary replaces marketing counters', async () => {
  (fetchPublishedReviewSummary as jest.Mock).mockResolvedValue({ count: 256, average: 4.7 });
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByText('4.7 / 5 (256 reviews)')).toBeTruthy());
});

test('network failure is not a missing profile and retry recovers', async () => {
  (fetchCreatorProfile as jest.Mock).mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce(detail());
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByText('Connection interrupted')).toBeTruthy());
  expect(screen.queryByText('This profile is unavailable.')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Retry profile' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Request shoot' })).toBeTruthy());
});

test('missing profile does not enable booking or share a fabricated creator', async () => {
  (fetchCreatorProfile as jest.Mock).mockResolvedValue(null);
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByText('This profile is unavailable.')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Request shoot' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share profile' })).toBeNull();
});

test('uncached models use the modeling workflow even without an hourly rate', async () => {
  const model = detail();
  model.profile.role = 'model';
  model.talent.hourly_rate = null as any;
  (fetchCreatorProfile as jest.Mock).mockResolvedValue(model);
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByText('Priced by service')).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Request shoot' }));
  expect(mockNavigate).toHaveBeenCalledWith('BookingForm', { modelId: 'creator-1', serviceType: 'modeling' });
});

test('unverified profiles cannot promise a booking and unsupported digital actions are absent', async () => {
  const pending = detail(); pending.profile.verified = false; pending.profile.kyc_status = 'pending';
  (fetchCreatorProfile as jest.Mock).mockResolvedValue(pending);
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByText('Verification pending')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Request shoot' })).toBeDisabled();
  expect(screen.queryByText('Subscribe')).toBeNull();
  expect(screen.queryByText('Send Tip')).toBeNull();
  expect(screen.queryByText('Collaborate')).toBeNull();
});

test('chat is checked by the server rather than denied by an empty booking cache', async () => {
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Message' })).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Message' }));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('ChatThread', { conversationId: 'chat-1', title: 'Shoot chat' }));
  expect(mockChat).toHaveBeenCalledWith('creator-1', 'Lebo Mokoena');
});

test('failed chat is visible, does not navigate, and can be retried', async () => {
  mockChat.mockRejectedValueOnce(new Error('Booking required')).mockResolvedValueOnce({ id: 'chat-1', title: 'Shoot chat' });
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Message' })).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Message' }));
  await waitFor(() => expect(screen.getByText('Booking required')).toBeTruthy());
  expect(mockNavigate).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Message' }));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
});

test('failed follow never claims success or rolls back unrelated state', async () => {
  (toggleFollow as jest.Mock).mockRejectedValueOnce(new Error('Follow unavailable')).mockResolvedValueOnce(true);
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Follow' })).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
  await waitFor(() => expect(screen.getByText('Follow unavailable')).toBeTruthy());
  expect(mockSetState).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
  await waitFor(() => expect(mockSetState).toHaveBeenCalledWith({ follows: [expect.objectContaining({ follower_id: 'client-1', following_id: 'creator-1' })] }));
});

test('duplicate follow presses are suppressed while the first write is pending', async () => {
  let finish!: (value: boolean) => void;
  (toggleFollow as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Follow' })).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
  fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
  expect(toggleFollow).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
});

test('native sharing uses the registered app route and counts only a confirmed share', async () => {
  const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  try {
    const screen = render(<UserProfileScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share profile' })).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'Share profile' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ title: 'Lebo Mokoena on Papzi', message: 'Lebo Mokoena on Papzi\npapzi://user/creator-1' }));
    expect(trackEvent).toHaveBeenCalledWith('profile_shared', { creator_id: 'creator-1', source: 'profile' });
  } finally { spy.mockRestore(); }
});

test('dismissed sharing does not record a referral or successful invitation', async () => {
  const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  try {
    const screen = render(<UserProfileScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share profile' })).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'Share profile' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(trackEvent).not.toHaveBeenCalledWith('profile_shared', expect.anything());
  } finally { spy.mockRestore(); }
});

test('cached recent work survives a refresh error with a retry action', async () => {
  context.state.posts = [{ id: 'post-1', author_id: 'creator-1', image_url: 'https://example.invalid/photo.jpg', caption: 'Portrait' }];
  (fetchCreatorPosts as jest.Mock).mockRejectedValue(new Error('Media connection interrupted'));
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByText(/Showing previously loaded work/)).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Open post Portrait' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry recent work' })).toBeTruthy();
});

test('profile report requires a reason and confirms only a successful server write', async () => {
  (reportContent as jest.Mock).mockResolvedValue(undefined);
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Report profile' })).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Report profile' }));
  expect(screen.getByRole('button', { name: 'Submit report' })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText('Report reason'), 'Impersonation');
  fireEvent.press(screen.getByRole('button', { name: 'Submit report' }));
  await waitFor(() => expect(screen.getByText('Report submitted for review.')).toBeTruthy());
  expect(reportContent).toHaveBeenCalledWith({ targetType: 'profile', targetId: 'creator-1', reason: 'Impersonation' });
});

test('report failure retains the reason and permits a retry without false success', async () => {
  (reportContent as jest.Mock).mockRejectedValueOnce(new Error('Report connection interrupted')).mockResolvedValueOnce(undefined);
  const screen = render(<UserProfileScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Report profile' })).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Report profile' }));
  fireEvent.changeText(screen.getByLabelText('Report reason'), 'Spam profile');
  fireEvent.press(screen.getByRole('button', { name: 'Submit report' }));
  await waitFor(() => expect(screen.getByText('Report connection interrupted')).toBeTruthy());
  expect(screen.getByLabelText('Report reason').props.value).toBe('Spam profile');
  expect(screen.queryByText('Report submitted for review.')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Submit report' }));
  await waitFor(() => expect(screen.getByText('Report submitted for review.')).toBeTruthy());
});
