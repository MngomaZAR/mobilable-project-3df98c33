import { environment } from './environment';

export const BETA_RESTRICTION_MESSAGE =
  'Payments, bank payouts, video calls and instant dispatch are unavailable in this testing build. No money will be processed.';

export const isRestrictedBeta = () => environment.restrictedBeta === true;

export type ServiceFeature = 'checkout' | 'payouts' | 'video' | 'dispatch';
let sessionToken: string | null = null;
let access: { token: string; expires: number; permissions: Record<ServiceFeature, boolean> } | null = null;

export const resetServiceAccess = (token: string | null = null) => { sessionToken = token; access = null; };
export const recordServiceAccess = (token: string, expiresAt: string, permissions: Record<ServiceFeature, boolean>) => {
  const expires = Date.parse(expiresAt);
  if (token !== sessionToken || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 65000) return false;
  access = { token, expires, permissions };
  return true;
};
export const isServiceRestricted = (feature: ServiceFeature, token = sessionToken) =>
  isRestrictedBeta() && !(token && access?.token === token && access.expires > Date.now() && access.permissions[feature] === true);

export const isBetaRestrictedRequest = (path: string, method = 'GET', body?: unknown, token?: string | null) => {
  if (!isRestrictedBeta() || method.toUpperCase() === 'GET') return false;
  const route = path.split('?')[0].replace(/\/+$/, '');
  if (/^\/financial(\/|$)/.test(route)) return isServiceRestricted('payouts', token ?? null);
  if (/^\/dispatch(\/|$)/.test(route)) {
    if (route === '/dispatch/respond' && body && typeof body === 'object' && 'response' in body && body.response === 'decline') return false;
    return isServiceRestricted('dispatch', token ?? null);
  }
  if (route === '/functions/livekit-token') {
    // Ending a previously opened room remains safe; never request a new token.
    return (!body || typeof body !== 'object' || !('action' in body) || body.action !== 'end') && isServiceRestricted('video', token ?? null);
  }
  if (route === '/functions/payout-methods') {
    return (!body || typeof body !== 'object' || !('action' in body) || body.action !== 'list') && isServiceRestricted('payouts', token ?? null);
  }
  if (/^\/functions\/(escrow-release|request-payout|payout-handler)(\/|$)/.test(route)) return isServiceRestricted('payouts', token ?? null);
  // Digital tips are not part of physical-service checkout acceptance.
  if (route === '/functions/tip-payment') return true;
  return (/^\/functions\/(payfast-handler|payfast-sign)(\/|$)/.test(route) || /^\/payments(\/|$)/.test(route))
    && isServiceRestricted('checkout', token ?? null);
};
