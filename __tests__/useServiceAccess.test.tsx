import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { useServiceAccess } from '../src/hooks/useServiceAccess';
import { apiClient } from '../src/config/apiClient';
import { resetServiceAccess, isBetaRestrictedRequest } from '../src/config/betaPolicy';

let mockUser = 'client-a';
let mockSession: any;
jest.mock('../src/config/environment', () => ({ environment: { backendProvider: 'api', restrictedBeta: true } }));
jest.mock('../src/store/AppDataContext', () => ({ useAppData: () => ({ state: { currentUser: mockUser ? { id: mockUser } : null } }) }));
jest.mock('../src/config/apiSession', () => ({ getApiSession: async () => mockSession, getCachedApiSession: () => mockSession }));
jest.mock('../src/config/apiClient', () => ({ apiClient: { get: jest.fn() } }));
const permission = () => ({ user_id: mockUser, expires_at: new Date(Date.now() + 60000).toISOString(),
  permissions: { checkout: true, video: true, dispatch: true, payouts: false } });
const Screen = () => { const access = useServiceAccess(); return <Text>{access.allowed('checkout') ? 'Checkout available' : 'Checkout disabled'}</Text>; };

beforeEach(() => {
  jest.clearAllMocks(); mockUser = 'client-a'; mockSession = { user: { id: mockUser }, access_token: 'a' };
  resetServiceAccess('a');
});

test('a current account receives memory-only permissions without enabling payouts', async () => {
  (apiClient.get as jest.Mock).mockResolvedValue(permission());
  const view = render(<Screen />);
  await waitFor(() => expect(view.getByText('Checkout available')).toBeTruthy());
  expect(isBetaRestrictedRequest('/payments/checkout', 'POST', {}, 'a')).toBe(false);
  expect(isBetaRestrictedRequest('/financial/payouts', 'POST', {}, 'a')).toBe(true);
});

test('an old account response cannot enable the new account after a switch', async () => {
  let resolveOld!: (value: unknown) => void;
  const old = permission();
  (apiClient.get as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockRejectedValue(new Error('Service access unavailable'));
  const view = render(<Screen />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
  mockUser = 'client-b'; mockSession = { user: { id: mockUser }, access_token: 'b' }; resetServiceAccess('b');
  view.rerender(<Screen />);
  await act(async () => { resolveOld(old); });
  await waitFor(() => expect(view.getByText('Checkout disabled')).toBeTruthy());
  expect(isBetaRestrictedRequest('/payments/checkout', 'POST', {}, 'b')).toBe(true);
});

test.each(['wrong-user', 'expired', 'malformed'])('unverified %s permissions remain disabled', async kind => {
  const response: any = permission();
  if (kind === 'wrong-user') response.user_id = 'other';
  if (kind === 'expired') response.expires_at = new Date(Date.now() - 1000).toISOString();
  if (kind === 'malformed') response.permissions.video = 'true';
  (apiClient.get as jest.Mock).mockResolvedValue(response);
  const view = render(<Screen />);
  await act(async () => {});
  expect(view.getByText('Checkout disabled')).toBeTruthy();
  expect(isBetaRestrictedRequest('/payments/checkout', 'POST', {}, 'a')).toBe(true);
});
