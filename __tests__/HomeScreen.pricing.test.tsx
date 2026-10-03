import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import HomeScreen, {
  formatPublishedHourlyRate,
  getPublishedHourlyRate,
  isHomeProviderOnline,
  isWithinHourlyBudget,
} from '../src/screens/HomeScreen';
import { useAppData } from '../src/store/AppDataContext';
import { fetchRecommendedMatches } from '../src/services/matchService';

jest.mock('../src/store/AppDataContext', () => ({ useAppData: jest.fn() }));
jest.mock('../src/store/MessagingContext', () => ({ useMessaging: () => ({ startConversationWithUser: jest.fn() }) }));
jest.mock('../src/services/matchService', () => ({ fetchRecommendedMatches: jest.fn() }));
jest.mock('../src/store/ThemeContext', () => ({
  useTheme: () => ({ colors: { bg: '#fff', card: '#fff', border: '#ccc', text: '#111', textSecondary: '#444', textMuted: '#666', accent: '#007AFF' }, isDark: false }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) }),
  useRoute: () => ({ params: {} }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('../src/components/AppLogo', () => ({ AppLogo: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
jest.mock('expo-blur', () => ({ BlurView: require('react-native').View }));

describe('Published hourly pricing', () => {
  it.each([undefined, null, '', ' ', '$$', 'R1500', 0, -100, NaN, Infinity, true, [], {}])('does not invent a rate for %p', value => {
    expect(getPublishedHourlyRate(value)).toBeNull();
    expect(formatPublishedHourlyRate(value)).toBe('Pricing not published');
    expect(isWithinHourlyBudget(value, 2000)).toBe(false);
  });

  it.each([800, 2300.5, '2300.50'])('uses the published amount %p', value => {
    const rate = Number(value);
    expect(getPublishedHourlyRate(value)).toBe(rate);
    expect(formatPublishedHourlyRate(value)).toBe(`R${rate.toLocaleString('en-ZA', { maximumFractionDigits: 2 })}/hr`);
  });

  it('uses an inclusive numeric hourly cap, with no implicit cap for Any budget', () => {
    expect(isWithinHourlyBudget(1000, 1000)).toBe(true);
    expect(isWithinHourlyBudget(1000.01, 1000)).toBe(false);
    expect(isWithinHourlyBudget(9000, null)).toBe(true);
    expect(isWithinHourlyBudget(null, null)).toBe(true);
  });

  it('requires both stored availability flags and approved KYC for an online claim', () => {
    const profile = { availability_status: 'online' as const, kyc_status: 'approved' as const };
    expect(isHomeProviderOnline({ is_online: true }, profile)).toBe(true);
    expect(isHomeProviderOnline({}, profile)).toBe(false);
    expect(isHomeProviderOnline({ is_online: false }, profile)).toBe(false);
    expect(isHomeProviderOnline({ is_online: true })).toBe(false);
    expect(isHomeProviderOnline({ is_online: true }, { ...profile, availability_status: 'offline' })).toBe(false);
    expect(isHomeProviderOnline({ is_online: true }, { ...profile, kyc_status: 'pending' })).toBe(false);
  });
});

const provider = (id: string, hourly_rate: number | null) => ({
  id, name: id, hourly_rate, price_range: '$$$', is_online: true,
  style: 'Portrait', tags: ['Portrait'], location: 'Durban', rating: 4.5,
  avatar_url: `https://example.com/${id}.jpg`,
});
const photographers = [provider('low', 800), provider('boundary', 1000), provider('high', 2300.5), provider('unpriced', null)];
const model = provider('model', 600);
const profile = (id: string, role = 'photographer') => ({
  id, role, kyc_status: 'approved', age_verified: true, availability_status: 'online',
});
const context = () => ({
  state: {
    currentUser: { id: 'client', role: 'client', city: 'Durban' },
    photographers, models: [model], bookings: [],
    profiles: [...photographers.map(item => profile(item.id)), profile(model.id, 'model')],
  },
  loading: false, error: null, refresh: jest.fn(),
});

const renderHome = async () => {
  const view = render(<HomeScreen />);
  await act(async () => { await Promise.resolve(); });
  return view;
};

describe('Home hourly budget integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAppData as jest.Mock).mockReturnValue(context());
    (fetchRecommendedMatches as jest.Mock).mockResolvedValue(photographers);
  });

  afterEach(() => jest.restoreAllMocks());

  it('shows actual rates and unknown pricing without guessed tiers or durations', async () => {
    const view = await renderHome();
    await waitFor(() => expect(view.getAllByText(formatPublishedHourlyRate(2300.5)).length).toBeGreaterThan(0));
    expect(view.getAllByText('Pricing not published').length).toBeGreaterThan(0);
    expect(view.queryByText('R1,200+')).toBeNull();
    expect(view.queryByText('~1 hour')).toBeNull();
    expect(view.queryByText('Min 2 hours')).toBeNull();
    expect(view.queryByText('Available Today')).toBeNull();
  });

  it('enforces the cap in every rail and recommendation, excluding unknown rates', async () => {
    const view = await renderHome();
    await waitFor(() => expect(view.getAllByTestId('home-provider-high')).toHaveLength(2));
    fireEvent.press(view.getByRole('button', { name: 'Hourly budget' }));
    fireEvent.press(view.getByRole('radio', { name: 'Up to R1,000/hr' }));
    fireEvent.press(view.getByText('Apply Filters'));
    await waitFor(() => expect(fetchRecommendedMatches).toHaveBeenLastCalledWith('', '', 1000));
    expect(view.queryByText('high')).toBeNull();
    expect(view.queryByText('unpriced')).toBeNull();
    expect(view.getAllByTestId('home-provider-boundary').length).toBeGreaterThan(0);
    expect(view.getByText('2 matching profiles')).toBeTruthy();

    fireEvent.press(view.getByRole('button', { name: 'Hourly budget' }));
    fireEvent.press(view.getByRole('radio', { name: 'Any budget' }));
    fireEvent.press(view.getByText('Apply Filters'));
    await waitFor(() => expect(fetchRecommendedMatches).toHaveBeenLastCalledWith('', '', 0));
    expect(view.getAllByTestId('home-provider-high').length).toBeGreaterThan(0);
    expect(view.getAllByTestId('home-provider-unpriced').length).toBeGreaterThan(0);
  });

  it('does not display stale recommendation prices instead of the current catalog', async () => {
    (fetchRecommendedMatches as jest.Mock).mockResolvedValue([provider('high', 50)]);
    const view = await renderHome();
    await waitFor(() => expect(view.getAllByTestId('home-provider-high')).toHaveLength(2));
    expect(view.queryByText(formatPublishedHourlyRate(50))).toBeNull();
    expect(view.getAllByText(formatPublishedHourlyRate(2300.5))).toHaveLength(2);
  });

  it('disables requests when only the profile claims online and updates when confirmed', async () => {
    const data = context();
    data.state.photographers = [ { ...photographers[0], is_online: false } ];
    (useAppData as jest.Mock).mockReturnValue(data);
    (fetchRecommendedMatches as jest.Mock).mockResolvedValue([]);
    const view = await renderHome();
    await waitFor(() => expect(view.getByRole('button', { name: 'Unavailable low' })).toBeDisabled());
    expect(view.getByText('0 online')).toBeTruthy();
    (useAppData as jest.Mock).mockReturnValue({ ...data, state: { ...data.state, photographers: [photographers[0]] } });
    view.rerender(<HomeScreen />);
    expect(view.getByRole('button', { name: 'Request low' })).not.toBeDisabled();
    expect(view.getByText('1 online')).toBeTruthy();
  });

  it('rechecks eligibility when profile verification changes', async () => {
    const data = context();
    const view = await renderHome();
    await waitFor(() => expect(view.getAllByTestId('home-provider-low')).toHaveLength(2));
    (useAppData as jest.Mock).mockReturnValue({ ...data, state: { ...data.state, profiles: data.state.profiles.map(item => ({ ...item, kyc_status: 'pending', verified: true })) } });
    view.rerender(<HomeScreen />);
    expect(view.queryByTestId('home-provider-low')).toBeNull();
    expect(view.getByText('0 matching profiles')).toBeTruthy();
  });

  it('applies the same numeric cap to models without requesting photographer matches', async () => {
    const view = await renderHome();
    await waitFor(() => expect(view.getAllByTestId('home-provider-high')).toHaveLength(2));
    fireEvent.press(view.getAllByText('Models')[0]);
    fireEvent.press(view.getByRole('button', { name: 'Hourly budget' }));
    fireEvent.press(view.getByRole('radio', { name: 'Up to R1,000/hr' }));
    fireEvent.press(view.getByText('Apply Filters'));
    expect(view.getByTestId('home-provider-model')).toBeTruthy();
    expect(view.queryByText('Recommended Photographers')).toBeNull();
    expect(fetchRecommendedMatches).toHaveBeenCalledTimes(1);
  });

  it('surfaces a rejected search without leaving Searching stuck', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    (fetchRecommendedMatches as jest.Mock).mockRejectedValue(new Error('unavailable'));
    const view = await renderHome();
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Search unavailable', expect.any(String)));
    expect(view.queryByText('Searching...')).toBeNull();
    expect(view.getByText('Find Photographers')).toBeTruthy();
  });
});
