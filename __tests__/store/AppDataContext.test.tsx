import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AppDataProvider, useAppData } from '../../src/store/AppDataContext';
import { supabase } from '../../src/config/supabaseClient';

// Mock Supabase — mockChannel must be inside the factory to avoid Jest hoisting issues
jest.mock('../../src/config/supabaseClient', () => {
  const mockChannel = {
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnThis(),
    unsubscribe: jest.fn(),
  };
  return {
    hasSupabase: true,
    supabase: {
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
        onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
      },
      channel: jest.fn().mockReturnValue(mockChannel),
      removeChannel: jest.fn(),
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
  };
});

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

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(getByTestId('loading-state').props.children).toBe('false');
    expect(supabase.from).toHaveBeenCalledWith('profiles');
  });
});
