import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AppDataProvider, useAppData } from '../../src/store/AppDataContext';
import { supabase } from '../../src/config/supabaseClient';

// Mock Supabase to avoid real backend calls in unit tests
jest.mock('../../src/config/supabaseClient', () => ({
  hasSupabase: true,
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// A dummy component to consume context
const TestComponent = () => {
  const { state, loading } = useAppData();
  return (
    <React.Fragment>
      <Text testID="loading-state">{loading ? 'true' : 'false'}</Text>
      <Text testID="photographers-count">{state.photographers.length.toString()}</Text>
    </React.Fragment>
  );
};

describe('AppDataContext', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('provides initial state and correctly sets loading to false after initialization', async () => {
    const { getByTestId } = render(
      <AppDataProvider>
        <TestComponent />
      </AppDataProvider>
    );

    // Initial render might briefly be loading or not depending on async storage mock resolution speed
    // Use act to wait for all the useEffects (like AsyncStorage load and Supabase fetch) to settle
    await act(async () => {
      // Allow promises to resolve
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(getByTestId('loading-state').props.children).toBe('false');
    // Ensure the fetchPhotographers mocked call was triggered
    expect(supabase.from).toHaveBeenCalledWith('photographers');
  });
});
