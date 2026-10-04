import { environment } from '../src/config/environment';
import { BETA_RESTRICTION_MESSAGE, isBetaRestrictedRequest } from '../src/config/betaPolicy';
import { apiClient } from '../src/config/apiClient';

jest.mock('../src/config/environment', () => ({ environment: {
  restrictedBeta: true, backendProvider: 'api', apiBaseUrl: 'https://api.unit.invalid',
} }));

beforeEach(() => { environment.restrictedBeta = true; jest.clearAllMocks(); });

test.each(['/functions/payfast-handler', '/functions/escrow-release', '/financial/refunds',
  '/financial/payouts', '/financial/operations/id/execute', '/dispatch/requests',
  '/dispatch/respond', '/payments/checkout'])('restricted beta refuses %s before network access', async path => {
  const original = global.fetch;
  global.fetch = jest.fn();
  try {
    await expect(apiClient.post(path, {})).rejects.toThrow(BETA_RESTRICTION_MESSAGE);
    expect(global.fetch).not.toHaveBeenCalled();
  } finally { global.fetch = original; }
});

test('video join is blocked but room cleanup is allowed', () => {
  expect(isBetaRestrictedRequest('/functions/livekit-token', 'POST', { action: 'join' })).toBe(true);
  expect(isBetaRestrictedRequest('/functions/livekit-token', 'POST', { action: 'end' })).toBe(false);
});

test('bank-account collection is blocked while owned readback remains allowed', () => {
  expect(isBetaRestrictedRequest('/functions/payout-methods', 'POST', { action: 'add' })).toBe(true);
  expect(isBetaRestrictedRequest('/functions/payout-methods', 'POST', { action: 'list' })).toBe(false);
});

test('auth, scheduled bookings, messages, moderation, readback and routing remain available', () => {
  for (const path of ['/auth/sign-in', '/auth/sign-up', '/bookings', '/bookings/quote', '/messages', '/data/select', '/admin/moderation']) {
    expect(isBetaRestrictedRequest(path, 'POST', {})).toBe(false);
  }
  expect(isBetaRestrictedRequest('/financial/capabilities', 'GET')).toBe(false);
  expect(isBetaRestrictedRequest('/routing/route', 'GET')).toBe(false);
});

test('non-beta builds retain server-owned capability decisions', () => {
  environment.restrictedBeta = false;
  expect(isBetaRestrictedRequest('/financial/payouts', 'POST')).toBe(false);
});
