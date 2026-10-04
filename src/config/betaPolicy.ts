import { environment } from './environment';

export const BETA_RESTRICTION_MESSAGE =
  'Payments, bank payouts, video calls and instant dispatch are unavailable in this testing build. No money will be processed.';

export const isRestrictedBeta = () => environment.restrictedBeta === true;

export const isBetaRestrictedRequest = (path: string, method = 'GET', body?: unknown) => {
  if (!isRestrictedBeta() || method.toUpperCase() === 'GET') return false;
  const route = path.split('?')[0].replace(/\/+$/, '');
  if (/^\/(financial|dispatch)(\/|$)/.test(route)) return true;
  if (route === '/functions/livekit-token') {
    // Ending a previously opened room remains safe; never request a new token.
    return !body || typeof body !== 'object' || !('action' in body) || body.action !== 'end';
  }
  if (route === '/functions/payout-methods') {
    return !body || typeof body !== 'object' || !('action' in body) || body.action !== 'list';
  }
  return /^\/functions\/(payfast-handler|payfast-sign|escrow-release|request-payout|payout-handler|tip-payment)(\/|$)/.test(route)
    || /^\/payments(\/|$)/.test(route);
};
